#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
DASHBOARD_URL="${DASHBOARD_URL:-http://127.0.0.1:4317}"
DASHBOARD_OPEN_BROWSER="${DASHBOARD_OPEN_BROWSER:-1}"
SERVICE_HEALTH_URL="$DASHBOARD_URL/health"
LOCK_DIR="${TMPDIR:-/tmp}/agent-dashboard-${UID}.launch-lock"
STARTUP_ATTEMPTS=60

pause_before_close() {
  if [[ -t 0 ]]; then
    read -r "?Press Return to close..."
  fi
}

open_dashboard() {
  [[ "$DASHBOARD_OPEN_BROWSER" == "0" ]] || open "$DASHBOARD_URL"
}

service_is_ready() {
  curl --silent --fail --max-time 2 "$SERVICE_HEALTH_URL" 2>/dev/null \
    | grep -q '"service":"@agent-dashboard/service"' \
    && curl --silent --fail --max-time 2 "$DASHBOARD_URL/" >/dev/null 2>&1
}

release_launch_lock() {
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

acquire_launch_lock() {
  local attempt
  for attempt in {1..50}; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      trap release_launch_lock EXIT INT TERM
      return 0
    fi
    if service_is_ready; then
      open_dashboard
      exit 0
    fi
    sleep 0.1
  done

  echo "Agent Dashboard is already being started by another launcher."
  echo "Try opening it again in a few seconds."
  pause_before_close
  exit 1
}

production_build_required() {
  local service_entry="apps/service/dist/server.js"
  local dashboard_entry="apps/dashboard/dist/index.html"

  [[ -f "$service_entry" && -f "$dashboard_entry" ]] || return 0
  find apps/service/src packages -type f -newer "$service_entry" -print -quit 2>/dev/null | grep -q . && return 0
  find apps/dashboard/src -type f -newer "$dashboard_entry" -print -quit 2>/dev/null | grep -q . && return 0
  [[ apps/service/package.json -nt "$service_entry" ]] && return 0
  [[ apps/service/tsup.config.ts -nt "$service_entry" ]] && return 0
  [[ apps/dashboard/package.json -nt "$dashboard_entry" ]] && return 0
  [[ apps/dashboard/vite.config.ts -nt "$dashboard_entry" ]] && return 0
  return 1
}

wait_until_ready() {
  local attempt
  for (( attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt++ )); do
    service_is_ready && return 0
    sleep 0.5
  done
  return 1
}

cd "$PROJECT_DIR" || exit 1

if service_is_ready; then
  open_dashboard
  exit 0
fi

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

acquire_launch_lock

APP_STATE_DIR="$(node -p 'require("node:os").homedir() + "/.agent-dashboard"')"
SERVICE_PID_FILE="$APP_STATE_DIR/service.pid"
SERVICE_LOG_FILE="$APP_STATE_DIR/service.log"
mkdir -p -m 700 "$APP_STATE_DIR" || {
  echo "Could not create the local Agent Dashboard data directory."
  pause_before_close
  exit 1
}

if [[ -f "$SERVICE_PID_FILE" ]]; then
  SERVICE_PID=""
  SERVICE_PROJECT=""
  IFS='|' read -r SERVICE_PID SERVICE_PROJECT < "$SERVICE_PID_FILE" || true
  SERVICE_COMMAND="$(ps -p "$SERVICE_PID" -o command= 2>/dev/null)"
  if [[ "$SERVICE_PID" == <-> \
    && "$SERVICE_PROJECT" == "$PROJECT_DIR" \
    && "$SERVICE_COMMAND" == *"apps/service/dist/server.js"* ]] \
    && kill -0 "$SERVICE_PID" >/dev/null 2>&1; then
    echo "Agent Dashboard is still starting (process $SERVICE_PID)."
    if wait_until_ready; then
      open_dashboard
      exit 0
    fi
    echo "The existing service did not become ready."
    echo "Details are in: $SERVICE_LOG_FILE"
    echo "If needed, stop process $SERVICE_PID before trying again."
    pause_before_close
    exit 1
  fi
  rm -f "$SERVICE_PID_FILE"
fi

NEEDS_BUILD=0
if production_build_required; then
  NEEDS_BUILD=1
fi

if [[ ! -d node_modules || "$NEEDS_BUILD" -eq 1 ]]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "Building Agent Dashboard requires pnpm 11."
    echo "Install it with: corepack enable && corepack prepare pnpm@11.18.0 --activate"
    pause_before_close
    exit 1
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "Installing Agent Dashboard dependencies (first launch only)..."
  pnpm install --frozen-lockfile || {
    echo "Dependency installation failed."
    pause_before_close
    exit 1
  }
fi

if (( NEEDS_BUILD == 1 )); then
  echo "Preparing the production application..."
  pnpm build || {
    echo "The production build failed."
    pause_before_close
    exit 1
  }
fi

export NODE_ENV="production"
export SERVICE_DASHBOARD_PATH="$PROJECT_DIR/apps/dashboard/dist"
export GITHUB_SYNC_ON_START="${GITHUB_SYNC_ON_START:-1}"
export CODEX_SYNC_ON_START="${CODEX_SYNC_ON_START:-1}"
export GITHUB_SYNC_INTERVAL_MS="${GITHUB_SYNC_INTERVAL_MS:-900000}"
export CODEX_SYNC_INTERVAL_MS="${CODEX_SYNC_INTERVAL_MS:-300000}"

echo "Starting Agent Dashboard in the background..."
nohup node --max-old-space-size=192 --expose-gc apps/service/dist/server.js </dev/null >>"$SERVICE_LOG_FILE" 2>&1 &
SERVICE_PID=$!
print -r -- "$SERVICE_PID|$PROJECT_DIR" > "$SERVICE_PID_FILE"
disown "$SERVICE_PID" 2>/dev/null || true

if wait_until_ready; then
  open_dashboard
  echo "Agent Dashboard is ready."
  echo "It will keep itself current in the background."
  exit 0
fi

echo "Agent Dashboard did not become ready within 30 seconds."
echo "Details are in: $SERVICE_LOG_FILE"
if ! kill -0 "$SERVICE_PID" >/dev/null 2>&1; then
  echo "The service exited during startup."
fi
pause_before_close
exit 1
