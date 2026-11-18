# Worklog Handoff

Checkpoint 2026-11-17 · Website release `worklog-today-20261117-01`

## Session close — November 17, 2026

All evening dashboard work is deployed. The current release is `worklog-today-20261117-01`, following `worklog-evening-20261117-01`; the portfolio refresh is also live. [Open Today](https://www.jimmyweber.com/worklog/?range=today). Released frontend source is `14c7eb9`; subsequent documentation is on GitHub `main`.

- Shipped: Today before 7 days, the date presets/custom picker, curved metric explorer, rolling 30D option, chart/table/CSV views, collapse/focus return, and the final canvas/accent low-fi activity scrollbar. The heatmap has no custom scrollbar.
- Today uses the latest shared, exact 24-hour report across devices, not two full calendar days. Git filters by instant; Codex uses matching aggregate windows. Token counters retain session-start-window semantics. Missing/partial/stale reporting remains qualified, and Today CSV includes UTC window bounds.
- Validation completed: 173 workspace tests, typecheck/build, both releases' installed/public checks, and live desktop/mobile browser flows at 320/390/1440 px. Release backups and guarded rollback are recorded in the website workspace's `PROJECTS-OPERATIONS.md` and [website handoff](../WEBSITE-HANDOFF.md).
- The user shut down the Windows desktop at session end. Its retained reports may become stale and Today may show partial coverage while it is offline; this is expected. Do not wake it or treat the planned shutdown as a collector incident. At the next sign-in, verify the existing single service and scheduled publisher resume and the Windows report advances.
- Both reporting services/publishers were updated; ledgers, native UI/packages, and startup settings were preserved. The Mac service/publisher remain in place. The owned localhost:4178 preview server was stopped; use the public site for the completed release.

Remaining maintenance: the Mac shared Dropbox Git metadata encountered an unreadable object and was not repaired. All released work is pushed. Continue from an independent clone outside Dropbox; the current release checkout is `/tmp/worklog-today-release-source` and may be removed by temporary-file cleanup. If absent, clone GitHub `main` afresh rather than relying on the old linked worktree. Preserve original source edits/conflict copies and back up metadata before any repair. [Git storage and recovery notes](git-storage.md).

The Mac mini enrollment and native Windows individual Agents/Subagents filters remain the previously documented pending work. No website deployment or runtime restart remains pending from this session.

## Start here

Worklog has a native macOS menu-bar popover and a Windows WPF tray flyout. Each machine runs one local Fastify service and keeps its own SQLite ledger. The local browser provides complete monthly Work History for that ledger. The public dashboard combines the MacBook Pro and Windows PC exports and shows source freshness for each machine. [Live Worklog](https://www.jimmyweber.com/worklog/) · [Website operations](../WEBSITE-HANDOFF.md)

Keep the product small. It is a personal work ledger, not an agent-control center, team analytics platform, or general project-management suite.

## What is implemented

- Native macOS menu-bar popover with cached-first loading and no Dock icon.
- Native Windows tray flyout with Tipoff-inspired charcoal/mint styling, one tray instance per session, snapshot caching, and optional Start with Windows (off by default).
- Both native apps offer **View on Website** at the bottom, opening [the public dashboard](https://jimmyweber.com/worklog). The Windows tray context menu offers the same action.
- Windows account facts use compact inline pairs in two columns. Five range metrics share one row, with agent and subagent totals below. Settings explains local tokens and partial coverage. Source status and freshness stay in the overview.
- Day, Week, Month, Year, and All summaries. Week is today plus the previous six local calendar days; Month is today plus the previous 29.
- macOS has six heatmap modes for the trailing 90 days, defaulting to All observed activity. Select a date to see commits, pushes, agents, and subagents separately.
- Windows has All (the default), Commit, Push, and Both heatmap modes with separate selected-day commit, push, agent, and subagent counts. All sums available activity; Both requires both Git counts.
- Observed token, commit, push, active-day, and project totals.
- Daily counts of distinct top-level Codex sessions and spawned subagents. Range totals sum those daily counts.
- Recent commit subjects and repository/ref push descriptions.
- Complete searchable monthly Work History in the local browser, with daily Codex activity and GitHub links on commit rows where available.
- Static public dashboard with Today (an exact shared 24-hour reporting window), date presets/custom ranges, a curved metric explorer with chart/table views and CSV export, persistent activity-chart scrolling, activity totals, a 90-day heatmap with All (the default), Both, and four individual metrics, a period chart, searchable project history, and per-device Sync status. Visitors can switch between green, neon blue, and grey. The header skull follows the selected palette, and each palette uses five heatmap tones with hatching for unavailable days. GitHub events are merged across machines and aggregate Codex activity is added across recording devices. [Website handoff](../WEBSITE-HANDOFF.md)
- Read-only GitHub collection across accessible owned, collaborator, and organization-member repositories.
- Experimental privacy-safe local Codex metadata/token collection.
- Official signed-in Codex account limits, reset times, lifetime usage facts, credits, and banked-reset collection.
- Durable idempotent SQLite ledger, source health, automatic refresh, and graceful SSE/service shutdown.

## Code map

The Windows Core project decodes display fields, App owns tray, service, cache, and startup behavior, and Tests exercises missing and zero values, schema and range validation, cache privacy, and account windows. [Windows build and usage notes](../apps/windows/README.md)

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
| Public activity frontend and publisher | `apps/website`, `apps/service/src/public-activity.ts` |
| Website header, palettes, and heatmap | `apps/website/src/index.html`, `apps/website/src/styles.css`, `apps/website/src/activity.js` |
| Website date ranges and exact Today selection | `apps/website/src/date-ranges.js`, `apps/website/src/today-range.js` |
| Curved metric explorer, qualified series, and CSV | `apps/website/src/metric-explorer.js`, `apps/website/src/metric-series.js` |
| Persistent activity-chart scrolling | `apps/website/src/plot-scrollbar.js` |
| Cross-device GitHub merge and Windows scheduled publisher | `apps/website/src/github-history.js`, `apps/website/publish-activity.py`, `apps/windows/scripts/register-website-publisher.ps1` |
| Durable storage | `packages/storage` |
| Event contracts | `packages/domain` |

## Local API

| Method and route | Meaning |
| --- | --- |
| `GET /health` | Service and collector health |
| `GET /api/snapshot` | Current overview, the 365-day Git calendar, and the separate 90-day `heatmapDays` projection |
| `GET /api/summary?period=day\|week\|month\|year\|all` | Selected-range totals and recent work |
| `GET /api/history?month=YYYY-MM` | Complete monthly work history and daily observed agent counts |
| `GET /api/website` | Per-machine public projection of project names, commit subjects and links, aggregate Codex usage, and source freshness |
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
- Windows Git metadata: `%LOCALAPPDATA%\Worklog\git`, outside Dropbox. The source checkout's `.git` pointer is Dropbox-ignored; retained worktrees were repaired. [Storage layout, migration checks, and recovery](git-storage.md).
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

The November 15 macOS heatmap change passed 131 workspace tests, type checking, the production build, and 18 Swift tests. The rebuilt app was relaunched and the heatmap rendered at menu-bar width with live data. Interactive popover inspection timed out.

On November 16 the Windows package was rebuilt and relaunched. The local service, collector output, startup registration, and scheduled publishing were verified. Windows model checks and the WPF build passed. The last recorded interactive Windows tray layout review was October 25.

The November 16 website releases passed 133 workspace tests, type checking, and production builds. Chromium verified the latest header in all three palettes at 320–1440 px, along with the earlier palette, heatmap, history, and Sync status changes. Both production feeds showed current commit, push, and Codex reports at the evening checkpoint. The Windows publisher's last run returned `0`, and the live device feed listed Windows PC as the only secondary publisher. [Release and verification notes](../WEBSITE-HANDOFF.md)

The November 17 heatmap update passed 136 workspace tests, type checking, production builds, and 19 Swift tests. The Mac app was packaged, signature-checked, relaunched, and rendered at menu-bar width with all six labels visible. Interactive native inspection timed out. The Windows source and cache checks were subsequently validated on Windows, along with the native WPF build and package. The website All/Both release passed installed asset and public URL checks, plus local/live browser checks at desktop and phone widths. All defaults to the sum of available commits, pushes, agents, and subagents; missing counts remain visible in day details.

Native Windows validation of source `953ee35` passed all 136 workspace tests, type checking, the production build, model checks, and the WPF build with zero warnings and errors. The packaged tray app was inspected with All selected initially. Switching All, Commit, Push, and Both preserved the selected date and all four exact counts. Live inspection distinguished a Codex-only day from a day with four measured zeros. Missing-value and legacy-cache cases passed the model checks. The package uses the retained Windows checkout outside Dropbox for its next service start and remains at the existing executable path. The single running service, ledger, startup setting, and publisher were preserved. [Windows validation and runtime location](../apps/windows/README.md#windows-validation-on-november-17-2026)

A follow-up Windows check exercised current and legacy saved-data rendering in an isolated harness built from the production view and resources. Refused and dropped loopback connections exercised the saved-data failure path, including clearing an earlier Day summary on a failed Week request. A focus-retention fix keeps keyboard selection usable after control rebuilds. The actual installed package was restarted at 150%/144 DPI and 200%/192 DPI, with mode controls, complete day details, scroll bounds, and taskbar placement checked. Windows scale was restored to 100%, and the rebuilt package returned to normal tray mode. All 152 workspace tests, type checking, production build, Windows model checks, and WPF build passed. [Detailed Windows evidence and test scope](../apps/windows/README.md#offline-cache-and-display-scale-validation-on-november-17-2026)

## Data limits that must remain visible

- GitHub push coverage is partial because GitHub does not expose unlimited historical push activity.
- Codex account limits and lifetime facts come from the official local app-server; local per-session token counters are displayed separately and are not billing-grade totals.
- Codex authentication remains owned by the Codex CLI. Worklog stores no credential or account email.
- The local Codex source format is unsupported and may change; its adapter is intentionally isolated and fail-closed around private content.
- Missing, zero, partial, stale, and unavailable are different states.
- Commits and pushes stay separate even when the heatmap uses Both mode.

## Pending work

- Enroll the Mac mini when it is ready. It has no live feed yet. Use [Mac mini enrollment](../WEBSITE-HANDOFF.md#mac-mini-enrollment) from that machine.
- The native Windows tray has All, Commit, Push, and Both modes; individual Agents and Subagents filters remain pending. Use the [Windows heatmap handoff](windows-heatmap-handoff.md) when working on native Agents and Subagents parity.

## Product guardrail

Keep one local service and one ledger per machine, read-only collectors, and complete monthly history. Publish only the allowlisted website feeds.
