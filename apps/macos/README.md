# Worklog menu-bar shell

A minimal native macOS 14+ companion for the local Agent Dashboard service. It displays cached data immediately, refreshes from `http://127.0.0.1:4317`, and has no Dock icon when packaged. The packaged app quietly starts the production service when needed.

## Develop

```sh
cd apps/macos
swift run AgentDashboardMenuBar
```

For `swift run`, start the local service yourself or set `AGENT_DASHBOARD_PROJECT_ROOT` to the repository root. Packaged builds remember their repository location and start the service automatically. If startup fails, the last successful snapshot remains visible with a quiet cached-data notice.

## Test

```sh
swift test
```

## Package

```sh
./scripts/package-app.sh
open dist/Worklog.app
```

Pass an output directory as the first argument to place `Worklog.app` elsewhere. The script builds a release executable and assembles an `LSUIElement` application bundle, so normal launches show only the menu-bar item.
