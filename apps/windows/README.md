# Worklog for Windows

A native WPF notification-area app using the shared Worklog service and a ledger on the Windows machine. The 360-unit flyout follows Tipoff's charcoal, gray, white, and mint design and Worklog's account card, period summaries, and grayscale heatmap.

## Build and run

Requires 64-bit Windows 10/11, .NET 9 SDK (including the Desktop Runtime), Node.js 24+, pnpm 11, and GitHub CLI. Authenticate with `gh auth login`. Install and sign in to Codex CLI with `codex login` for account limits; local sessions need an existing Codex state index. The Windows app has no NuGet dependencies.

From the repository root in PowerShell:

```powershell
pnpm install --frozen-lockfile
pnpm build
dotnet run --project apps/windows/Worklog.Tests --configfile apps/windows/NuGet.Config
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/package-app.ps1
Start-Process apps/windows/dist/Worklog.exe
```

Packaging records the checkout and Node paths in `checkout.json`. Keep the checkout, dependencies, and command-line tools available. Repackage after moving them. This is an unsigned source build, not a standalone installer or published Windows release. Copying only Worklog.exe to another computer will not work. A custom output location can be supplied with `-OutputDirectory`.

The npm Codex launcher on Windows is a command shim; packaging resolves its native x64 executable when available. Alternatively set `CODEX_BINARY` to an absolute `codex.exe` path before packaging. If it cannot be found, account limits remain unavailable; local metadata collection is independent.

## Tray behavior

- The first launch opens the flyout. Left-click the tray icon to toggle it; right-click for Open, Refresh, View on Website, Settings, or Quit. Check the hidden-icons arrow if needed.
- The flyout closes on focus loss or Escape. `Worklog.exe --inspect` keeps it open for inspection.
- Day, Week, Month, Year, and All use the existing service summaries. Week is today plus six previous local dates; Month is today plus 29. Year is the calendar year. Reporting defaults to America/Denver; the service inherits `SERVICE_TIMEZONE` when started.
- The account card keeps remaining-use gauges and reset countdowns above six compact facts: lifetime tokens, peak day, current streak, best streak, banked resets, and credits. Facts use small inline label/value pairs in two columns. Long values are trimmed with their full value available in a tooltip.
- Local tokens, commits, pushes, active days, and projects fit in one row. Agent and subagent range totals appear below. Selected range and heatmap-mode buttons use dark text on mint.
- The heatmap shows up to the last 90 reported days in All, Commit, Push, and Both modes. All is the initial selection and sums available commits, pushes, agents, and subagents. Both combines commits and pushes. Click a day for all four separate counts, with unavailable values labeled. Older saved snapshots fall back to their Git calendar and leave agents unavailable. Keyboard focus and accessible labels are provided for each cell.
- Codex account limits and reset times appear separately from local session token counters. Unknown values display an em dash. Source status, freshness, and coverage remain visible; push history is partial.
- View on Website opens [the public Worklog dashboard](https://jimmyweber.com/worklog) in your default browser. The local API provides complete monthly history at `GET /api/history?month=YYYY-MM` while the service is running.
- Settings explains local token counters and partial push and agent history. Source status, freshness, and coverage stay in the overview.
- Settings also offers Start with Windows, off by default. It registers this executable for the current user. Keep it at a stable path. Windows Startup Apps can separately disable it; there is no installer or automatic updater.
- Only one tray instance runs per Windows session. It reuses the healthy Worklog service on port 4317 or starts the built service without a console window. The UI polls every 30 seconds and on open, or every two seconds while collectors are running; collectors keep their existing 15-minute GitHub and five-minute Codex schedules. Refresh requests all collectors; results arrive on subsequent polls.
- Quitting the tray leaves the service running, like macOS. Before updating running service code, stop the Worklog Node process after verifying its command line points to this checkout's `apps/service/dist/server.js`.

## Local state and privacy

The ledger stays at `~/.agent-dashboard/agent-dashboard.sqlite`. The Windows flyout stores its last decoded snapshot at `%LOCALAPPDATA%\Worklog\snapshot.json`. Only known display fields are cached, never raw prompts, responses, tools, or credentials. This snapshot includes private project/usage metadata. Saved snapshots are labeled when the service is unavailable; selected-range totals remain unavailable until the service responds rather than reusing a different period.

Service stdout/stderr is drained without retention by the Windows launcher. The tray and service use one local ledger.

## Website publishing

Start with Windows launches the tray and its local collector at sign-in. The separate publisher task sends GitHub history and aggregate Codex activity at sign-in and every five minutes while signed in. Verify the task's last result before checking its timestamps in the public **Sync status** table. [Publisher registration and verification](../../WEBSITE-HANDOFF.md#windows-publisher-registration)

## Updating

The existing Windows Dropbox checkout uses `%LOCALAPPDATA%\Worklog\git` for Git metadata. Its `.git` file is a local Dropbox-ignored pointer, and both retained worktrees use the same local metadata. Keep that directory and the retained runtime checkout available. [Git storage, verification, and recovery](../../docs/git-storage.md) records the layout and backup. Moving Git metadata alone does not change the package's checkout path or require an app/service restart.

Quit Worklog from its tray menu before replacing the executable. Pull the latest source, run `pnpm install --frozen-lockfile` and `pnpm build`, repeat the packaging command, then launch `apps/windows/dist/Worklog.exe`. If service code changed, stop the existing Worklog Node process after verifying its command line points to this checkout's `apps/service/dist/server.js`; the next app launch starts the new service. The Windows launcher does not write the macOS launcher's `service.pid` file. Reuse the same output directory when Start with Windows is enabled, or enable it again from the new executable's Settings.

## Validation

```powershell
pnpm test
pnpm typecheck
pnpm build
dotnet run --project apps/windows/Worklog.Tests --configfile apps/windows/NuGet.Config
dotnet build apps/windows/Worklog.App --configfile apps/windows/NuGet.Config
git diff --check
```

Native macOS checks still require macOS and Swift. For Windows UI review, package and launch with `--inspect`, then check tray toggle, focus dismissal, range changes, heatmap selection, View on Website, startup settings, and saved-data behavior with the service stopped.

## Windows validation on November 17, 2026

Source `953ee35` passed 136 workspace tests, type checking, the production build, Windows model checks, and a native WPF build with zero warnings and errors. The package was rebuilt and inspected at the existing `apps/windows/dist/Worklog.exe` path. All was selected initially. All, Commit, Push, and Both switched correctly, retained the selected date, and displayed separate commit, push, agent, and subagent counts. A day with two agents and zero Git activity changed intensity between All and Both. A day with four measured zeros stayed dark.

The model checks covered unavailable values, Codex-only activity, legacy Git-calendar fallback, an explicitly empty daily projection, and the typed cache round trip. The initial pass checked offline and legacy-cache cases at model level. The follow-up UI and display-scale checks are recorded below.

Dropbox was synchronizing source and dependency files during validation. The validated Windows checkout is retained at `%LOCALAPPDATA%\WorklogPreviews\windows-all-source-20261117`, with its production service build and Windows dependencies. The generated `checkout.json` points there, while the executable remains at its existing Dropbox path. Preserve this retained checkout when using this package, or repackage from another stable Windows checkout. The native SQLite binding and the built service's external dependencies were resolved successfully there.

The existing service process and ledger remained in use throughout inspection. The startup registration and scheduled website publisher were verified after packaging. The updated executable was returned to normal tray mode.

## Offline-cache and display-scale validation on November 17, 2026

The follow-up used source based on `492be33` and fixed keyboard focus loss when a range, heatmap mode, or selected day rebuilds the controls. Worklog restores the corresponding new control when focus was within the window. Keyboard activation and subsequent Tab navigation were verified in the packaged app.

An isolated harness compiled the production `MainWindow.xaml`, `MainWindow.xaml.cs`, and application resources. Its copy of `LocalService` used a synthetic cache directory, a separate loopback endpoint, and a shorter timeout. Cold starts received a refused connection. A second case received a successful Day summary, then the fixture connection was dropped before selecting Week. The production saved-data/error path rendered both the current nullable daily cache and a legacy Git-only cache. All was initially selected, all four heatmap modes switched, and selected-day details retained zero and unavailable values. The failed Week request cleared the previous Day totals.

The installed `Worklog.exe` was restarted and inspected at each Windows display setting on the 3440 × 1440 primary display:

| Windows scale | Native window DPI | Native window size in pixels | Work area in pixels |
| --- | --- | --- | --- |
| 100%, restored | 96 | 360 × 746 | 3440 × 1392 |
| 150% | 144 | 540 × 1119 | 3440 × 1368 |
| 200% | 192 | 720 × 1276 | 3440 × 1344 |

At 150% and 200%, the four heatmap buttons, wrapped day details, scroll area, fixed footer, and placement within the taskbar work area were checked. Keyboard focus survived a mode activation at 200% and advanced to the next control. The original 100% setting was restored through Windows Settings, and the final package was checked again at 96 DPI.

All 152 workspace tests, type checking, the production build, Windows model checks, and WPF build passed. WPF reported zero warnings and errors. Local screenshots, Win32 DPI measurements, fixture observations, and restoration records are retained under `%LOCALAPPDATA%\WorklogPreviews\windows-ui-cache-validation-20261117\evidence`.

The offline checks used the isolated production-view harness. The installed package was checked against the live service at each scale. The live ledger, cache, service process, startup registration, and publisher remained in use. The test harness and fixture server were closed, and the final Worklog package was returned to normal tray mode.

## Rolling 24-hour publisher update on November 17, 2026

The retained Windows runtime checkout was advanced to `fc347c3`. All 158 workspace tests, type checking, the production build, and the native SQLite binding check passed. The verified old service was stopped once; the existing tray started its replacement from the retained checkout. One service remained bound to loopback, the ledger passed SQLite's quick check with no lost event rows, and the native executable, package checkout pointer, startup registration, and outside-Dropbox Git storage were preserved.

The scheduled `Worklog Website Publisher (windows-pc)` now runs `apps/website/publish-activity.py` from `%LOCALAPPDATA%\WorklogPreviews\windows-all-source-20261117`, with that checkout as its working directory. Its Python executable, SSH alias, destination, device slug, triggers, principal, and settings were preserved. A triggered run returned `0`; the live Windows device feed retained all four rolling 24-hour observations and `occurredAt` on every published Git event. Each observation spans exactly 24 hours, ending at a quarter-hour boundary; the four end times are 15 minutes apart. The Mac and Windows feeds shared all four exact start/end pairs during verification. Codex collection retained its partial coverage status.

An intervening unattended publisher run returned `1`; a foreground rerun, scheduled retrigger, and the next automatic run at 23:06 Denver time returned `0`. The windowless task retained no failure detail. A Codex account refresh reported a protocol error, then a requested refresh succeeded without another service restart. Local Codex coverage remained partial throughout.

Update and build this retained checkout before restarting the installed service; changing only the Dropbox source does not update the package's service build or scheduled publisher. Private baseline, ledger backup, and validation records are retained under `%LOCALAPPDATA%\WorklogPreviews\windows-today-runtime-20261117\evidence`, outside Git and Dropbox. Static website publication is tracked separately in the [website handoff](../../WEBSITE-HANDOFF.md).

## Next implementation

At session close on November 18, the website's Today feature is published and both devices support four aligned 24-hour observations; exact shared windows were verified during release. The closing check found Windows healthy and publishing, with the Mac primary feed stale and no current overlap. The installed native package still includes the November 17 keyboard, offline-cache, and DPI work; the reporting service and publisher remain on the validated `fc347c3` build. Native Day remains a calendar-day summary. No further Windows restart or package update is pending for Today. [Closing handoff and publisher follow-up](../../docs/handoff.md#closing-checkpoint)

The Windows daily heatmap still needs Agents and Subagents modes. The [Windows heatmap handoff](../../docs/windows-heatmap-handoff.md) describes the existing service data, cache compatibility, and Windows verification.
