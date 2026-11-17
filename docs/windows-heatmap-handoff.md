# Windows heatmap handoff

Status on 2026-11-16 · Native Windows parity is pending. The Windows PC already publishes daily agent and subagent counts to the public heatmap. The macOS app is the native reference for the two additional modes.

## Native Windows scope

Add **Agents** and **Subagents** to the existing Windows tray heatmap. Keep **Commit**, **Push**, and **Both** and the 360-unit WPF flyout. Selecting a day should show separate counts for commits, pushes, agents, and subagents, matching the Mac app. [Public heatmap reference](https://www.jimmyweber.com/worklog/)

Windows already displays agent and subagent totals for the selected range. Its **Open Work History** action opens the shared local browser archive, which already provides GitHub links on commit rows when a URL is available. Verify that flow on Windows alongside the heatmap work.

## Data and implementation

- `GET /api/snapshot` already returns `heatmapDays` under schema version 1. It contains 90 chronological local dates when a source is available and an empty array otherwise. Each row has `date` in `YYYY-MM-DD` and nullable numeric `commits`, `pushes`, `agents`, and `subagents`. Treat the date as a calendar date in the snapshot's reporting timezone. [Snapshot builder](../apps/service/src/snapshot.ts)
- The Windows snapshot model currently reads `activityDays` with Git counts only. Decode and cache the additive `heatmapDays` display fields. Prefer that array whenever present, including an empty array. If the property is missing or null in an older service response or saved snapshot, fall back to the last 90 rows of `activityDays` and leave agent counts unavailable. Keep the existing typed cache allowlist. [Windows snapshot model](../apps/windows/Worklog.Core/Models.cs)
- Extend `RenderHeatmap`, `mode`, and `selectedDay` in the existing WPF flyout and retain its 15-column grid. Keep the selected date on metric switches and refresh while the date remains in range. Use the latest day for the initial selection and if the previous selection rolls out of the window. Changing the range picker should still change totals and recent work independently of the 90-day grid. [WPF flyout](../apps/windows/Worklog.App/MainWindow.xaml.cs)
- Render unavailable cells distinctly from measured zero and keep exact counts in the selected-day summary. Use the unavailable treatment for **Both** when either Git count is missing. Keep the selected border, keyboard focus, and accessible day labels clear in all five modes. Check focus after `Render()` rebuilds the controls.
- Reuse the one local service and the persisted daily Codex observations. Agent and subagent sessions count once per active reporting date, and historical coverage depends on retained records. See the [data contract](data-contract.md) and the [SwiftUI heatmap](../apps/macos/Sources/AgentDashboardMenuBar/ActivityHeatmapView.swift) for reference.

## Verify on Windows

1. Extend the [Windows model checks](../apps/windows/Worklog.Tests/Program.cs) to cover the new array, legacy cache fallback, a Codex-only snapshot, zero and null, and a cache round trip that keeps only display fields. [Service integration tests](../apps/service/test/codex-integration.test.ts) already exercise the Codex-only and date-boundary cases.
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

4. Check all modes and select a day with the mouse and keyboard. Verify the counts against the local snapshot, the compact layout at normal and increased display scaling, and the saved snapshot when the service is unavailable. Check startup or refresh on an older cache with Git-only cells. Verify the Work History action and follow a GitHub commit link from the archive.
5. Update the Windows README and the [main handoff](handoff.md) once the feature works in the packaged app. Record the actual validation and push the task commit.

On November 16 the current Windows package was rebuilt and its local service and website publishing were verified. Interactive validation of the future Windows heatmap modes remains part of the parity task.
