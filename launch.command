#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
DASHBOARD_URL="http://127.0.0.1:5173"
SERVICE_HEALTH_URL="http://127.0.0.1:4317/health"
LOCK_DIR="${TMPDIR:-/tmp}/agent-dashboard-${UID}.lock"
LOCK_OWNER_FILE="$LOCK_DIR/owner"
STARTUP_TIMEOUT_SECONDS=300
STARTUP_ATTEMPTS=$(( STARTUP_TIMEOUT_SECONDS * 2 ))
OPENER_PID=""

pause_before_close() {
  if [[ -t 0 ]]; then
    read -r "?Press Return to close..."
  fi
}

service_syncs_are_terminal() {
  curl --silent --fail --max-time 2 "$SERVICE_HEALTH_URL" \
    | node -e '
          let input = "";
          process.stdin.on("data", (chunk) => { input += chunk; });
          process.stdin.on("end", () => {
            try {
              const health = JSON.parse(input);
              const terminal = new Set(["idle", "succeeded", "partial", "failed", "disabled"]);
              process.exit(
                health.status === "ok"
                  && terminal.has(health.githubSync)
                  && terminal.has(health.codexSync)
                  ? 0
                  : 1,
              );
            } catch {
              process.exit(1);
            }
          });
        ' >/dev/null 2>&1
}

dashboard_is_healthy() {
  curl --silent --fail --max-time 2 "$DASHBOARD_URL" >/dev/null 2>&1 \
    && curl --silent --fail --max-time 5 "$DASHBOARD_URL/api/snapshot" >/dev/null 2>&1
}

stack_is_ready() {
  service_syncs_are_terminal && dashboard_is_healthy
}

report_readiness_failure() {
  if ! curl --silent --fail --max-time 2 "$DASHBOARD_URL" >/dev/null 2>&1; then
    echo "- Dashboard server is not responding on port 5173."
  fi
  if ! curl --silent --fail --max-time 5 "$DASHBOARD_URL/api/snapshot" >/dev/null 2>&1; then
    echo "- Snapshot API is not returning a successful response."
  fi

  local health
  health="$(curl --silent --fail --max-time 2 "$SERVICE_HEALTH_URL" 2>/dev/null)" || {
    echo "- Local service is not responding on port 4317."
    return
  }
  print -rn -- "$health" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const health = JSON.parse(input);
        console.log(`- GitHub sync: ${String(health.githubSync ?? "unknown")}; Codex sync: ${String(health.codexSync ?? "unknown")}.`);
      } catch {
        console.log("- Local service returned an unreadable health response.");
      }
    });
  '
}

lock_owner_is_this_launcher() {
  local owner_pid="$1"
  local owner_project="$2"
  local owner_command

  [[ "$owner_pid" == <-> ]] || return 1
  [[ "$owner_project" == "$PROJECT_DIR" ]] || return 1
  kill -0 "$owner_pid" >/dev/null 2>&1 || return 1
  owner_command="$(ps -p "$owner_pid" -o command= 2>/dev/null)"
  [[ "$owner_command" == *"launch.command"* ]]
}

release_lock() {
  local recorded_pid=""
  if [[ -f "$LOCK_OWNER_FILE" ]]; then
    IFS='|' read -r recorded_pid _ < "$LOCK_OWNER_FILE" || true
  fi
  if [[ "$recorded_pid" == "$$" ]]; then
    rm -f "$LOCK_OWNER_FILE"
    rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if [[ -n "$OPENER_PID" ]]; then
    kill "$OPENER_PID" >/dev/null 2>&1 || true
  fi
  release_lock
}

acquire_lock() {
  local owner_pid=""
  local owner_project=""
  local attempt

  if mkdir "$LOCK_DIR" 2>/dev/null; then
    print -r -- "$$|$PROJECT_DIR" > "$LOCK_OWNER_FILE"
    return 0
  fi

  # The winning launcher may still be writing its owner record.
  for attempt in {1..10}; do
    if [[ -f "$LOCK_OWNER_FILE" ]]; then
      IFS='|' read -r owner_pid owner_project < "$LOCK_OWNER_FILE" || true
      break
    fi
    sleep 0.1
  done

  if lock_owner_is_this_launcher "$owner_pid" "$owner_project"; then
    if stack_is_ready; then
      echo "Agent Dashboard is already running. Opening it now."
      open "$DASHBOARD_URL"
    else
      echo "Agent Dashboard is already starting (launcher PID $owner_pid)."
      echo "Wait for its original Terminal window to report that live data is ready."
      pause_before_close
    fi
    exit 0
  fi

  # No matching live launcher owns this exact lock, so clean up the stale record
  # and retry the atomic mkdir. Never signal or terminate the recorded PID.
  rm -f "$LOCK_OWNER_FILE"
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Agent Dashboard could not acquire its startup lock."
    echo "Another launcher may have started at the same time; try again in a moment."
    pause_before_close
    exit 1
  fi
  print -r -- "$$|$PROJECT_DIR" > "$LOCK_OWNER_FILE"
}

cd "$PROJECT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Agent Dashboard needs Node.js 24 or newer."
  echo "Install Node.js, then run this launcher again."
  pause_before_close
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 24 )); then
  echo "Agent Dashboard needs Node.js 24 or newer; found $(node --version)."
  pause_before_close
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Agent Dashboard needs pnpm 11."
  echo "Install it with: corepack enable && corepack prepare pnpm@11.18.0 --activate"
  pause_before_close
  exit 1
fi

acquire_lock
trap cleanup EXIT INT TERM

if [[ ! -d node_modules ]]; then
  echo "Installing Agent Dashboard dependencies..."
  pnpm install || {
    echo "Dependency installation failed."
    pause_before_close
    exit 1
  }
fi

export GITHUB_SYNC_ON_START="${GITHUB_SYNC_ON_START:-1}"
export CODEX_SYNC_ON_START="${CODEX_SYNC_ON_START:-1}"

echo "Starting Agent Dashboard..."
echo "The dashboard will open automatically after live data is ready at $DASHBOARD_URL"
echo "Press Control-C to stop it."
echo

(
  for (( attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt++ )); do
    if stack_is_ready; then
      echo "Live data is ready. Opening Agent Dashboard."
      open "$DASHBOARD_URL"
      exit 0
    fi
    sleep 0.5
  done
  echo
  echo "Agent Dashboard did not become ready within ${STARTUP_TIMEOUT_SECONDS} seconds."
  echo "The dashboard, snapshot API, and completed startup syncs are all required."
  report_readiness_failure
  echo "Review the errors above, then press Control-C and launch it again."
) &
OPENER_PID=$!

pnpm dev
