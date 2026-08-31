#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
DASHBOARD_URL="http://127.0.0.1:5173"

cd "$PROJECT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Agent Dashboard needs Node.js 24 or newer."
  echo "Install Node.js, then run this launcher again."
  read -r "?Press Return to close..."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 24 )); then
  echo "Agent Dashboard needs Node.js 24 or newer; found $(node --version)."
  read -r "?Press Return to close..."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Agent Dashboard needs pnpm 11."
  echo "Install it with: corepack enable && corepack prepare pnpm@11.18.0 --activate"
  read -r "?Press Return to close..."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing Agent Dashboard dependencies..."
  pnpm install || {
    echo "Dependency installation failed."
    read -r "?Press Return to close..."
    exit 1
  }
fi

export GITHUB_SYNC_ON_START="${GITHUB_SYNC_ON_START:-1}"
export CODEX_SYNC_ON_START="${CODEX_SYNC_ON_START:-1}"

echo "Starting Agent Dashboard..."
echo "The dashboard will open automatically at $DASHBOARD_URL"
echo "Press Control-C to stop it."
echo

(
  for _ in {1..120}; do
    if curl --silent --fail "$DASHBOARD_URL" >/dev/null 2>&1; then
      open "$DASHBOARD_URL"
      exit 0
    fi
    sleep 0.25
  done
) &
OPENER_PID=$!

cleanup() {
  kill "$OPENER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

pnpm dev
