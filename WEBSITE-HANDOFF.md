# Worklog website

The MacBook Pro and Windows PC publish to the [live Worklog dashboard](https://www.jimmyweber.com/worklog/). The top navigation links to **History** and **Sync status**. The 90-day heatmap uses the latest published date, while the activity chart follows the selected period. Select a date to see commits, pushes, agents, and subagents. Hatching marks unavailable days for the selected heatmap metric. Searchable project history includes direct GitHub commit links where available.

The header squares switch between green, neon blue, and grey. Green is the default, and the browser remembers the selected palette when storage is available. Each palette has a zero tone and four activity tones scaled to the highest observed day for the selected metric.

Worklog counts each top-level Codex session or spawned subagent once per reporting date with observed activity. Range totals sum those daily counts. Historical coverage depends on retained metadata. Commit subjects open their exact GitHub commit when the export includes a URL. [Local API contract](docs/data-contract.md)

## Build and publish

1. Run `pnpm --filter @agent-dashboard/website build`. Publish only `index.html`, `styles.css`, `activity.js`, `github-history.js`, and `preview.png` from `apps/website/dist` to the site's `/worklog/` directory.
2. Run the local Worklog service and allow its GitHub and Codex syncs to finish. The loopback endpoint `GET /api/website` produces the public data feed.
3. The primary publisher runs `python3 apps/website/publish-activity.py SSH_ALIAS ABSOLUTE_WEB_DIRECTORY`. An additional device passes `--device DEVICE-SLUG`. The static frontend reads `activity.json` and `codex-devices.json` alongside `index.html`.

Use the site's existing explicit-file release workflow and retain the production backup. Give changed CSS and JavaScript asset references a new cache version. Verify the deployed assets and browser behavior at desktop and mobile widths. The live JSON feeds are owned by the machine publishers. Keep both out of static releases and Git.

The data export carries repository names, commit subjects, and GitHub commit links, including activity from private repositories, and aggregate counts. GitHub handles repository access when visitors follow a commit link. The export excludes Codex session identifiers and account details, commit bodies, and credentials. Keep the export, database, and SSH config out of Git. The host serves static files and Worklog's collectors run locally.

## Current publishers

- **MacBook Pro, primary.** `com.jimmyweber.worklog-service` starts the service at login. `com.jimmyweber.worklog-publish` writes `activity.json` every 15 minutes while the service is reachable. To restart the service after building, run `launchctl kickstart -k "gui/$(id -u)/com.jimmyweber.worklog-service"`. To stop publishing, unload `com.jimmyweber.worklog-publish` with `launchctl bootout` and move its plist out of `~/Library/LaunchAgents/`.
- **Windows PC, `windows-pc`.** Worklog starts at Windows sign-in. The current-user Task Scheduler job `Worklog Website Publisher (windows-pc)` runs at sign-in and every five minutes while signed in. It writes that device's entry in `codex-devices.json`. To confirm the scheduler run, use `Get-ScheduledTaskInfo -TaskName 'Worklog Website Publisher (windows-pc)'` and check `LastTaskResult` is `0`. Then confirm the corresponding source times on the site after the local collectors and publisher have both run.

Keep one primary publisher for `activity.json`. Give each additional machine a unique, stable slug and the same reporting timezone (`America/Denver` for this site). Offline machines retain their last published data. The dashboard adds daily agents and subagents and monthly observed tokens across recording devices. Keep Codex session stores and SQLite ledgers local to each machine so copied records cannot count twice.

The Sync status table shows each machine’s last successful GitHub commit, GitHub push, and Codex reports in the reporting timezone. Each source becomes stale at 35 minutes, allowing time for the regular collection and publishing intervals. Sources without a usable timestamp show Unavailable. The site evaluates freshness each time the dashboard loads.

GitHub history combines the published ledgers. Commits count once per repository and SHA. Identified pushes count once per GitHub repository activity ID, preserving distinct pushes on the same day. The publisher hashes repository and push IDs from the existing local monthly history API before upload. For older push records without a matching ID, the dashboard preserves the largest reported count per repository and day as a lower bound. GitHub push history remains partial.

## Windows publisher registration

On Windows, enable **Start with Windows** from the tray settings, then run this from the checkout with Python 3.8+ and an existing noninteractive SSH alias with a verified host key:

```powershell
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/register-website-publisher.ps1 `
  -SshAlias SSH_ALIAS -WebDirectory ABSOLUTE_WEB_DIRECTORY -Device windows-pc
```

Registration verifies an initial upload before creating the scheduled task. Reuse the same slug when updating a machine's publisher.

## Mac mini enrollment

The Mac mini has no feed as of November 16, 2026. When it is ready:

1. Set up the [macOS source build](README.md#macos) on the Mini. Authenticate GitHub and Codex for that user, use `America/Denver`, and start one local Worklog service. Enable the packaged app's login item or use the existing macOS service launch-agent pattern. Check `http://127.0.0.1:4317/health` and let local GitHub and Codex collection finish. Local Codex reporting requires observed activity on that device.
2. Configure Python 3.8+ and the existing noninteractive SSH connection with a verified host key. From the checkout, run `python3 apps/website/publish-activity.py SSH_ALIAS ABSOLUTE_WEB_DIRECTORY --device mac-mini` using the site's configured alias and directory. Keep credentials and machine-specific connection settings in local configuration.
3. Add a per-user LaunchAgent in `~/Library/LaunchAgents/` with a distinct label such as `com.jimmyweber.worklog-publish-mac-mini`, `RunAtLoad` enabled, and `StartInterval` set to 900 seconds. Its `ProgramArguments` should contain the absolute Python path, absolute path to `publish-activity.py`, SSH alias, absolute remote web directory, `--device`, and `mac-mini` as separate entries. Validate the plist with `plutil -lint` and load it with `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jimmyweber.worklog-publish-mac-mini.plist"` if using that label.
4. Open [Sync status](https://www.jimmyweber.com/worklog/#sync-title) and verify the **Mac mini** row alongside the MacBook Pro and Windows PC. After the next scheduled run, reload the site and confirm the Mini's report times advance. Check that a commit visible on two devices appears once in History.

## Release history

Release `worklog-multi-device-20261116-01` installed `activity.js` and `index.html` with a production backup through the website release workflow. Desktop and mobile checks verified that the live heatmap and monthly token total include the Windows PC alongside the MacBook Pro. The primary and device data files are managed by their publishers and are outside this code release.

Release `worklog-shared-github-20261116-01` added `github-history.js` and updated `activity.js` and `index.html`. Desktop and mobile checks verified the merged commit links and push totals, including the Windows ledger’s nine November 10–11 commits that were missing from the MacBook Pro feed.

Release `worklog-sync-status-20261116-02` installed the Sync status table. Browser checks verified live source timestamps, and fixture checks covered current, stale, and unavailable reports down to a 320-pixel viewport.

Release `worklog-frontend-20261116-01` updated the dashboard layout, charts, and navigation. The charts sit side by side on wide screens and stack on narrow screens. The date controls scroll within each chart, and the heatmap keeps weekday labels visible while scrolling. History and Sync status are reachable from the top navigation. Local and live Chromium checks covered 320–1440 px, month URLs, metric changes, keyboard navigation, project search, commit links, and an unavailable feed. Release `worklog-frontend-20261116-02` corrected the social preview image description. Both releases deployed only static frontend files.

Release `worklog-palettes-20261116-01` added the palette controls and five higher-contrast heatmap tones. Local and live browser checks verified palette changes, persistence, zero and unavailable days, and keyboard and touch controls at 320–1440 px. Git tag `worklog-frontend-green-20261116` identifies the previous frontend.

The site was first published in release `worklog-dashboard-20261115-01`. Release `worklog-heatmap-20261115-01` added the heatmap and clickable commit subjects. The existing [Worklog portfolio page](https://www.jimmyweber.com/pages/projects/worklog/) links to the dashboard, and the dashboard appears in the XML sitemap. Releases back up site files separately from the live activity feed.

## Link preview

`preview.png` is the existing portfolio Worklog banner center-cropped and resized with Lanczos to 1200 × 630. The initial HTML supplies the canonical URL and Open Graph and Twitter image metadata. Browser and Facebook crawler checks verified `/worklog` and `/worklog/`, the preview image MIME type and dimensions, and the release check verified its checksum. Messages rendering was outside these checks.
