# Worklog website

The public frontend shows activity totals, charts, and searchable project history. The 90-day heatmap switches between **Commits**, **Pushes**, **Agents**, and **Subagents**. Select a date to inspect all four counts. Hatching marks unavailable days for the selected metric. The heatmap stays anchored to the latest published date while visitors browse individual months. [JimmyWeber.com/worklog](https://www.jimmyweber.com/worklog/)

Worklog counts each top-level Codex session or spawned subagent once per reporting date with observed activity. Range totals sum those daily counts. Historical coverage depends on retained metadata. Commit subjects open their exact GitHub commit when the export includes a URL. [Local API contract](docs/data-contract.md)

## Build and publish

1. Run `pnpm --filter @agent-dashboard/website build`. Publish only `index.html`, `styles.css`, `activity.js`, and `preview.png` from `apps/website/dist` to the site's `/worklog/` directory.
2. Run the local Worklog service and allow its GitHub and Codex syncs to finish. The loopback endpoint `GET /api/website` produces the public data feed.
3. Run `python3 apps/website/publish-activity.py SSH_ALIAS ABSOLUTE_WEB_DIRECTORY` using the site's existing SSH setup. The script replaces only `activity.json` after export and validation succeed. Serve that file alongside `index.html`.

The data export carries repository names, commit subjects, and GitHub commit links, including activity from private repositories, and aggregate counts. GitHub handles repository access when visitors follow a commit link. The export excludes Codex session identifiers and account details, commit bodies, and credentials. Keep the export, database, and SSH config out of Git. The host serves static files and Worklog's collectors run locally.

On Jimmy's Mac, `com.jimmyweber.worklog-service` starts the existing Worklog service at login. `com.jimmyweber.worklog-publish` sends a fresh export every 15 minutes while that service is reachable. If the service is unavailable, the website serves its last published export and displays the last source sync times. To restart the service after building, run `launchctl kickstart -k "gui/$(id -u)/com.jimmyweber.worklog-service"`. To stop automatic publishing, unload the publisher with `launchctl bootout "gui/$(id -u)/com.jimmyweber.worklog-publish"` and move its plist out of `~/Library/LaunchAgents/`.

## Additional devices

Keep one primary publisher for GitHub history and that machine’s Codex activity. Each additional device runs its own local Worklog service and calls the same publisher with `--device DEVICE-SLUG`. This updates that device’s entry in `codex-devices.json` alongside the primary feed. The public dashboard adds daily agents and subagents and monthly observed tokens across devices, and shows each device’s last Codex sync. Offline devices retain their last published data. The upload contains only counts, dates, reporting timezone, and the configured label. Keep the data feeds out of Git and out of static-code deployments.

Use a unique, stable slug and the primary publisher’s reporting timezone for each device. Each session counts once per active day on the recording device. Keep Codex session stores local to each machine so copied records cannot count twice. The existing MacBook Pro publisher stays primary. To add a Mac mini, run a local service and configure its own recurring publisher with `--device mac-mini`. Work across toolkit projects is covered wherever it produces GitHub activity visible to the primary collector or local Codex metadata visible to an enrolled device.

On Windows, enable **Start with Windows** from the tray settings, then run this from the checkout with Python 3.8+ and an existing noninteractive SSH alias with a verified host key:

```powershell
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/register-website-publisher.ps1 `
  -SshAlias SSH_ALIAS -WebDirectory ABSOLUTE_WEB_DIRECTORY -Device windows-pc
```

Registration verifies an initial upload before adding the current-user Task Scheduler job. The task runs at sign-in and every five minutes while the user is signed in. Confirm the task’s last run result and check the Windows PC source timestamp on the website after the next automatic run.

Release `worklog-multi-device-20261116-01` installed `activity.js` and `index.html` with a production backup through the website release workflow. Desktop and mobile checks verified that the live heatmap and monthly token total include the Windows PC alongside the MacBook Pro. The primary and device data files are managed by their publishers and are outside this code release.

The site was first published in release `worklog-dashboard-20261115-01`. Release `worklog-heatmap-20261115-01` added the heatmap and clickable commit subjects. The existing [Worklog portfolio page](https://www.jimmyweber.com/pages/projects/worklog/) links to the dashboard, and the dashboard appears in the XML sitemap. Releases back up site files separately from the live activity feed.

## Link preview

`preview.png` is the existing portfolio Worklog banner center-cropped and resized with Lanczos to 1200 × 630. The initial HTML supplies the canonical URL and Open Graph and Twitter image metadata. The live image and checksum were verified with browser and Facebook crawler user agents. Messages rendering was outside these checks.
