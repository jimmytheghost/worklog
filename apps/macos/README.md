# Worklog menu-bar shell

A minimal native macOS 14+ app for the local Worklog service. It displays cached data immediately, refreshes from `http://127.0.0.1:4317`, and has no Dock icon when packaged. The packaged app quietly starts the one production service when needed.

The popover includes Day, rolling seven-day Week, rolling 30-day Month, Year, and All summaries and a clickable trailing 90-day grayscale heatmap with All, Commit, Push, Both, Agents, and Subagents modes. All is the initial selection and sums the available counts across all four activity types. Both combines commits and pushes. Select a day to see all four counts. Unavailable values appear as dashes. The popover also includes recent work, refresh, View on Website, and quit controls. View on Website opens [the public Worklog dashboard](https://jimmyweber.com/worklog) in your browser. Week and Month both include today as their last day.

Heatmap dates follow the local service's reporting timezone and stay fixed when you change the summary range. Each top-level Codex session or spawned subagent counts once per active date. Earlier days depend on retained local records. The selected-day detail shows a dash for an unavailable count and zero for an observed day with no qualifying activity.

Click the header gear to open Settings. **Start on computer startup** uses macOS Login Items to open Worklog when you sign in. The switch reflects the system setting; if macOS requires approval, Settings links to Login Items. Changing startup behavior requires the packaged app, rather than `swift run`.

## Website publishing

The app starts or reuses the local collector. Website publishing uses a separate schedule and the service's allowlisted projection. See the [current MacBook Pro publisher](../../WEBSITE-HANDOFF.md#current-publishers) and [Mac mini enrollment](../../WEBSITE-HANDOFF.md#mac-mini-enrollment).

The November 17 website releases, including Today, are live. Today is a website preset using a shared 24-hour report; the native Day summary remains a local calendar day. The Mac reporting backend and publisher were updated without changing native UI, startup, or the ledger. The last native heatmap validation passed 19 Swift tests; later website-only checks do not claim additional native UI verification. [Release and validation record](../../WEBSITE-HANDOFF.md#release-history)

The shared Mac Git metadata encountered an unreadable object during release. Source was preserved and the release completed from an independent clone outside Dropbox. That shared metadata remains unrepaired. Use an independent checkout for development and retain the packaged app's existing runtime path until deliberately migrating it; the temporary release clone is not a runtime dependency. [Git recovery status](../../docs/git-storage.md#mac-release-checkout-november-17-2026)

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

The repository path is embedded at packaging time. Run the packaging script again if the repository moves. The generated `dist/Worklog.app` is a local build artifact and is not committed.

The bundle includes `Resources/Worklog.icns`, with a mint activity trace on a graphite tile. To regenerate all icon sizes and the PNG preview from the vector drawing:

```sh
swift scripts/generate-icon.swift
```
