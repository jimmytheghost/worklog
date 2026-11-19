# Windows heatmap handoff

Status on 2026-11-17 · All is packaged and verified as the default on Windows. Individual Agents/Subagents filters remain pending. The Windows PC already publishes daily agent and subagent counts to the public heatmap. The macOS app is the native reference for the two additional modes.

## Native Windows scope

Add **Agents** and **Subagents** to the existing Windows tray heatmap. Keep **All** (the default), **Commit**, **Push**, and **Both** and the 360-unit WPF flyout. Preserve the already-implemented selected-day counts for commits, pushes, agents, and subagents. [Public heatmap reference](https://www.jimmyweber.com/worklog/)

Windows already displays agent and subagent totals for the selected range. Its **View on Website** action opens [the public Worklog dashboard](https://jimmyweber.com/worklog). The local monthly history API provides GitHub links on commit rows when a URL is available.

## Data and implementation

- `GET /api/snapshot` already returns `heatmapDays` under schema version 1. It contains 90 chronological local dates when a source is available and an empty array otherwise. Each row has `date` in `YYYY-MM-DD` and nullable numeric `commits`, `pushes`, `agents`, and `subagents`. Treat the date as a calendar date in the snapshot's reporting timezone. [Snapshot builder](../apps/service/src/snapshot.ts)
- The Windows snapshot model now decodes and caches `heatmapDays` for the default All filter, including nullable agent counts. Prefer that array whenever present, including an empty array. If the property is missing or null in an older service response or saved snapshot, fall back to the last 90 rows of `activityDays` and leave agent counts unavailable. Keep the existing typed cache allowlist. [Windows snapshot model](../apps/windows/Worklog.Core/Models.cs)
- Extend `RenderHeatmap`, `mode`, and `selectedDay` in the existing WPF flyout and retain its 15-column grid. Keep the selected date on metric switches and refresh while the date remains in range. Use the latest day for the initial selection and if the previous selection rolls out of the window. Changing the range picker should still change totals and recent work independently of the 90-day grid. [WPF flyout](../apps/windows/Worklog.App/MainWindow.xaml.cs)
- Render unavailable cells distinctly from measured zero and keep exact counts in the selected-day summary. Use the unavailable treatment for **Both** when either Git count is missing. Keep the selected border, keyboard focus, and accessible day labels clear in all six modes. Check focus after `Render()` rebuilds the controls.
- Reuse the one local service and the persisted daily Codex observations. Agent and subagent sessions count once per active reporting date, and historical coverage depends on retained records. See the [data contract](data-contract.md) and the [SwiftUI heatmap](../apps/macos/Sources/AgentDashboardMenuBar/ActivityHeatmapView.swift) for reference.

## Verify on Windows

1. Extend the [Windows model checks](../apps/windows/Worklog.Tests/Program.cs) for the two additional modes while retaining the existing daily-array, legacy-cache, Codex-only, zero/null, and typed-cache privacy checks. [Service integration tests](../apps/service/test/codex-integration.test.ts) already exercise the Codex-only and date-boundary cases.
2. Run the shared checks, Windows model checks, and WPF build below. Follow the [Windows update instructions](../apps/windows/README.md#updating) to restart an older service if it is still running.

   ```powershell
   pnpm test
   pnpm typecheck
   pnpm build
   dotnet run --project apps/windows/Worklog.Tests --configfile apps/windows/NuGet.Config
   dotnet build apps/windows/Worklog.App --configfile apps/windows/NuGet.Config
   git diff --check
   ```

3. Package and launch the tray app on Windows.

   ```powershell
   powershell -ExecutionPolicy Bypass -File apps/windows/scripts/package-app.ps1
   Start-Process apps/windows/dist/Worklog.exe -ArgumentList '--inspect'
   ```

4. Check all modes and select a day with the mouse and keyboard. Verify the counts against the local snapshot, the compact layout at normal and increased display scaling, and the saved snapshot when the service is unavailable. Check startup or refresh on an older cache with Git-only cells. Verify the View on Website action. Open Project history on the website and follow a GitHub commit link.
5. Update the Windows README and the [main handoff](handoff.md) once the feature works in the packaged app. Record the actual validation and push the task commit.

The November 17 All changes passed native Windows model checks and WPF build with zero warnings and errors. Shared validation passed 136 tests, type checking, and the production build in a retained Windows checkout outside Dropbox. The package at `apps/windows/dist/Worklog.exe` was inspected with the live local service. All was initially selected. All, Commit, Push, and Both switching preserved the selected date and separate counts. Live days verified Codex-only and measured-zero activity. Unavailable values, an explicitly empty projection, legacy fallback, and cache privacy passed model checks.

The package's generated configuration points to the retained checkout with a valid service build and native Windows dependencies. The existing service process, ledger, startup setting, and website publisher were preserved. The app was returned to normal tray mode. The follow-up isolated UI harness exercised current and legacy cache rendering with refused and dropped fixture connections. The actual native package was restarted and inspected at 150%/144 DPI and 200%/192 DPI, then returned to 100%. The check found and fixed keyboard focus loss after control rebuilds. [Windows validation record](../apps/windows/README.md#offline-cache-and-display-scale-validation-on-november-17-2026)

At session close on November 18, the installed native package still includes the November 17 focus/cache/DPI fix. The one Windows service and scheduled publisher use the retained checkout built at `fc347c3`; its Git metadata is outside Dropbox. The live website's Today preset and rolling-window export are complete and add no native heatmap modes. Use the [current runtime and publisher record](../apps/windows/README.md#rolling-24-hour-publisher-update-on-november-17-2026) and [Git storage notes](git-storage.md) before updating or repackaging. Interactive validation of Agents and Subagents remains part of this future parity task.
