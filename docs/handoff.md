# Worklog Handoff

Checkpoint: 2026-10-25

## Start here

Worklog has a native macOS menu-bar popover and a Windows WPF tray flyout backed by one local Fastify/SQLite service. Its job is to remember GitHub work across every accessible project and show Codex account limits separately from locally observed token totals. The daily loop is: click Worklog, inspect a range or heatmap day, optionally open the complete monthly Work History, then close it.

Keep the product small. It is a personal work ledger, not an agent-control center, team analytics platform, or general project-management suite.

## What is implemented

- Native macOS menu-bar popover with cached-first loading and no Dock icon.
- Native Windows tray flyout with Tipoff-inspired charcoal/mint styling, one tray instance per session, snapshot caching, and optional Start with Windows (off by default).
- Windows account facts use compact inline pairs in two columns. The five range metrics share one row, and selected buttons use dark text on mint. The local-token/push-coverage disclaimer lives in Settings; source status and freshness stay in the overview.
- Day, Week, Month, Year, and All summaries. Week is today plus the previous six local calendar days; Month is today plus the previous 29.
- Fixed trailing 90-day grayscale heatmap with Commit, Push, and Both modes.
- Click-to-inspect heatmap days with separate commit and push counts.
- Observed token, commit, push, active-day, and project totals.
- Recent commit subjects and repository/ref push descriptions.
- Complete searchable monthly Work History in the browser.
- Read-only GitHub collection across accessible owned, collaborator, and organization-member repositories.
- Experimental privacy-safe local Codex metadata/token collection.
- Official signed-in Codex account limits, reset times, lifetime usage facts, credits, and banked-reset collection.
- Durable idempotent SQLite ledger, source health, automatic refresh, and graceful SSE/service shutdown.

## Code map

Windows also has a native WPF tray app in `apps/windows/`, using this same service and ledger. See [Windows build and usage notes](../apps/windows/README.md). Its Core project decodes only display fields, App owns tray/service/cache/startup behavior, and Tests exercises missing/zero values, schema/range validation, cache privacy, and account windows. No macOS native source is changed by the Windows implementation.

| Area | Main location |
| --- | --- |
| Native popover composition | `apps/macos/Sources/AgentDashboardMenuBar/DashboardMenuView.swift` |
| Native heatmap | `apps/macos/Sources/AgentDashboardMenuBar/ActivityHeatmapView.swift` |
| Native API/cache state | `apps/macos/Sources/AgentDashboardMenuBar/SnapshotStore.swift` |
| Native decoded models | `apps/macos/Sources/AgentDashboardMenuBar/Models.swift` |
| Windows flyout and settings | `apps/windows/Worklog.App/MainWindow.xaml`, `apps/windows/Worklog.App/MainWindow.xaml.cs` |
| Windows tray and service lifecycle | `apps/windows/Worklog.App/App.xaml.cs`, `apps/windows/Worklog.App/LocalService.cs` |
| Windows display models and checks | `apps/windows/Worklog.Core/Models.cs`, `apps/windows/Worklog.Tests/Program.cs` |
| Local HTTP routes/lifecycle | `apps/service/src/app.ts` |
| Range aggregation | `apps/service/src/period-summary.ts` |
| Snapshot/history aggregation | `apps/service/src/snapshot.ts`, `apps/service/src/history.ts` |
| GitHub synchronization | `apps/service/src/github-sync.ts` |
| Codex synchronization | `apps/service/src/codex-sync.ts`, `apps/service/src/codex-account-sync.ts` |
| Browser UI | `apps/dashboard/src` |
| Durable storage | `packages/storage` |
| Event contracts | `packages/domain` |

## Local API

| Method and route | Meaning |
| --- | --- |
| `GET /health` | Service and collector health |
| `GET /api/snapshot` | Current overview plus trailing 90-day activity |
| `GET /api/summary?period=day\|week\|month\|year\|all` | Selected-range totals and recent work |
| `GET /api/history?month=YYYY-MM` | Complete monthly work-history data |
| `GET /api/events` | Live server-sent refresh notifications |
| `POST /api/sync` | Refresh all collectors |
| `POST /api/sync/github` | Refresh GitHub only |
| `POST /api/sync/codex` | Refresh Codex only |

The service listens on `http://127.0.0.1:4317`. The development dashboard listens on `http://127.0.0.1:5173`.

## Local state and runtime

- Database: `~/.agent-dashboard/agent-dashboard.sqlite`
- macOS launcher service log: `~/.agent-dashboard/service.log`; Windows launcher output is drained without retention.
- Pre-vNext database backup: `~/.agent-dashboard/backups/agent-dashboard-before-vnext-20260831.sqlite`
- Packaged app: `apps/macos/dist/Worklog.app` (ignored build artifact)
- The package script embeds the repository path in the app bundle. Repackage if the repository moves.
- The packaged app starts the service if it is not healthy and reuses an existing healthy instance.
- Windows package: `apps/windows/dist/Worklog.exe` (ignored build artifact), with checkout/Node/native Codex paths recorded in `checkout.json`.
- Windows cache: `%LOCALAPPDATA%\Worklog\snapshot.json`, containing decoded display fields only. Saved-data mode does not reuse stale totals from a different selected range.
- Windows polls snapshots on open and every 30 seconds, or every two seconds during collection. Both native clients leave the service running when quit.

## Verification and packaging

Shared checks and macOS packaging, from the repository root on macOS:

```sh
pnpm test
pnpm typecheck
pnpm build
swift test --package-path apps/macos
apps/macos/scripts/package-app.sh
codesign --verify --deep --strict apps/macos/dist/Worklog.app
plutil -lint apps/macos/dist/Worklog.app/Contents/Info.plist
```

Launch the packaged app with:

```sh
open apps/macos/dist/Worklog.app
```

SwiftPM under Command Line Tools may report a successful test build without printing XCTest execution details. Treat a clean build as useful but retain focused model tests and verify the packaged app interactively for native UI changes.

On Windows, run the shared `pnpm test`, `pnpm typecheck`, and `pnpm build` checks, then:

```powershell
dotnet run --project apps/windows/Worklog.Tests --configfile apps/windows/NuGet.Config
dotnet build apps/windows/Worklog.App --configfile apps/windows/NuGet.Config
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/package-app.ps1
Start-Process apps/windows/dist/Worklog.exe
```

The October 25 Windows pass verified 121 workspace tests, type checking, production builds, Windows model checks, package generation, and live layout inspection. Swift checks were not run on the Windows host. See the Windows README for update/service restart instructions and the remaining manual interaction checks.

## Data limits that must remain visible

- GitHub push coverage is partial because GitHub does not expose unlimited historical push activity.
- Codex account limits and lifetime facts come from the official local app-server; local per-session token counters are displayed separately and are not billing-grade totals.
- Codex authentication remains owned by the Codex CLI. Worklog stores no credential or account email.
- The local Codex source format is unsupported and may change; its adapter is intentionally isolated and fail-closed around private content.
- Missing, zero, partial, stale, and unavailable are different states.
- Commits and pushes stay separate even when the heatmap uses Both mode.

## Recommended next session

1. Open the packaged app and collect the next visual/interaction tweaks from real use.
2. Keep changes inside the compact popover or Work History unless a new surface is clearly necessary.
3. Add a focused regression test whenever a tweak changes range boundaries, snapshot decoding, service lifecycle, or collector counts.
4. Re-run the full verification and repackage before the next checkpoint.

Likely future exploration includes clearer source-coverage detail and continued visual polish. Do not invent billing totals or add always-running agents to simulate unavailable data.

## Product guardrail

The best next version is the smallest version that answers the user's real daily questions more clearly. Preserve one service, local-only storage, read-only collectors, exhaustive history, and a popover that never needs babysitting.
