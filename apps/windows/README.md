# Worklog for Windows

A native WPF notification-area app using the same local service and ledger as the macOS app. The 360-unit flyout follows Tipoff's charcoal, gray, white, and mint design and Worklog's account card, period summaries, and grayscale heatmap.

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

- The first launch opens the flyout. Left-click the tray icon to toggle it; right-click for Open, Refresh, Work History, Settings, or Quit. Check the hidden-icons arrow if needed.
- The flyout closes on focus loss or Escape. `Worklog.exe --inspect` keeps it open for inspection.
- Day, Week, Month, Year, and All use the existing service summaries. Week is today plus six previous local dates; Month is today plus 29. Year is the calendar year. Reporting defaults to America/Denver; the service inherits `SERVICE_TIMEZONE` when started.
- The heatmap shows up to the last 90 reported days in Commit, Push, and Both modes. Click a day for separate counts. Keyboard focus and accessible labels are provided for each cell.
- Codex account limits and reset times appear separately from local session token counters. Unknown values display an em dash. Source status, freshness, and coverage remain visible; push history is partial.
- Work History opens the existing complete searchable monthly browser history. It requires the service.
- Settings offers Start with Windows, off by default. It registers this executable for the current user. Keep it at a stable path. Windows Startup Apps can separately disable it; there is no installer or automatic updater.
- Only one tray instance runs per Windows session. It reuses the healthy Worklog service on port 4317 or starts the built service without a console window. The UI polls every 30 seconds and on open, or every two seconds while collectors are running; collectors keep their existing 15-minute GitHub and five-minute Codex schedules. Refresh requests all collectors; results arrive on subsequent polls.
- Quitting the tray leaves the service running, like macOS. Before updating running service code, stop the Worklog Node process after verifying its command line points to this checkout's `apps/service/dist/server.js`.

## Local state and privacy

The ledger stays at `~/.agent-dashboard/agent-dashboard.sqlite`. The Windows flyout stores its last decoded snapshot at `%LOCALAPPDATA%\Worklog\snapshot.json`. Only known display fields are cached, never raw prompts, responses, tools, or credentials. This snapshot includes private project/usage metadata. Saved snapshots are labeled when the service is unavailable; selected-range totals remain unavailable until the service responds rather than reusing a different period.

No additional collector, database, telemetry, or remote service is introduced. Service stdout/stderr is drained without retention by the Windows launcher.

## Validation

```powershell
pnpm test
pnpm typecheck
pnpm build
dotnet run --project apps/windows/Worklog.Tests --configfile apps/windows/NuGet.Config
dotnet build apps/windows/Worklog.App --configfile apps/windows/NuGet.Config
git diff --check
```

Native macOS checks still require macOS and Swift. For Windows UI review, package and launch with `--inspect`, then check tray toggle, focus dismissal, range changes, heatmap selection, history, startup settings, and saved-data behavior with the service stopped.
