# Worklog website

Canonical URL is [JimmyWeber.com/worklog](https://www.jimmyweber.com/worklog/). The public frontend shows activity totals, a 90-day heatmap, monthly or daily charts, and searchable project history. The heatmap stays anchored to the latest published date while visitors browse individual months. Worklog counts each top-level Codex session or spawned subagent once per reporting date with observed activity. Range totals add those daily counts. Retained index and rollout metadata determine historical coverage.

## Build and publish

1. Run `pnpm --filter @agent-dashboard/website build`. Publish only `index.html`, `styles.css`, `activity.js`, and `preview.png` from `apps/website/dist` to the site's `/worklog/` directory.
2. Run the local Worklog service and allow its GitHub and Codex syncs to finish. The loopback endpoint `GET /api/website` produces the public data feed.
3. Run `python3 apps/website/publish-activity.py SSH_ALIAS ABSOLUTE_WEB_DIRECTORY` using the site's existing SSH setup. The script replaces only `activity.json` after export and validation succeed. Serve that file alongside `index.html`.

The data export carries repository names, commit subjects, and GitHub commit links, including activity from private repositories, and aggregate counts. GitHub handles repository access when visitors follow a commit link. The export excludes Codex session identifiers and account details, commit bodies, and credentials. Keep the export, database, and SSH config out of Git. The host serves static files and Worklog's collectors run locally.

On Jimmy's Mac, `com.jimmyweber.worklog-service` starts the existing Worklog service at login. `com.jimmyweber.worklog-publish` sends a fresh export every 15 minutes while that service is reachable. If the service is unavailable, the website serves its last published export and displays the last source sync times. To restart the service after building, run `launchctl kickstart -k "gui/$(id -u)/com.jimmyweber.worklog-service"`. To stop automatic publishing, unload the publisher with `launchctl bootout "gui/$(id -u)/com.jimmyweber.worklog-publish"` and move its plist out of `~/Library/LaunchAgents/`.

The site was first published in release `worklog-dashboard-20261115-01`. Release `worklog-heatmap-20261115-01` added the heatmap and clickable commit subjects. The existing [Worklog portfolio page](https://www.jimmyweber.com/pages/projects/worklog/) links to the dashboard, and the dashboard appears in the XML sitemap. Releases back up site files separately from the live activity feed.

## Link preview

`preview.png` is the existing portfolio Worklog banner center-cropped and resized with Lanczos to 1200 × 630. The initial HTML supplies the canonical URL and Open Graph and Twitter image metadata. The live image and checksum were verified with browser and Facebook crawler user agents. Messages rendering was outside these checks.
