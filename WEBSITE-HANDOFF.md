# Worklog website

Session close 2026-11-18: production is `worklog-today-20261117-01`, following `worklog-evening-20261117-01`. The portfolio refresh is also live. No static release is pending for these features. [Runtime and remaining work](docs/handoff.md#closing-checkpoint)

The MacBook Pro and Windows PC publish to the [live Worklog dashboard](https://www.jimmyweber.com/worklog/). The top navigation links to **History** and **Sync status**. The 90-day heatmap uses the latest published date, while the activity chart follows the selected period. The default All filter sums available commits, pushes, agents, and subagents. Both combines commits and pushes; the four individual filters remain available. All labels partially observed totals as partial, and selected-day details keep unavailable counts distinct from zero. Select a date to see all four counts. Hatching marks unavailable days for the selected heatmap metric. Searchable project history includes direct GitHub commit links where available.

The frontend has persistent horizontal scroll controls to the activity bar chart with square canvas-colored buttons and accent-colored arrows, a canvas-colored proportional thumb with an accent grip, and a checkerboard track. The heatmap keeps its ordinary horizontal scrolling without custom controls. The controls support dragging, arrow/page keys, Home/End, and ordinary chart scrolling. They stay visible when all dates fit, with scrolling disabled. Native overlay scrollbars are hidden only after the custom controls initialize. Desktop and 320-pixel browser checks verified dragging, keyboard/button scrolling, chart metric/range changes, and the disabled state when dates fit. Published in `worklog-evening-20261117-01`.

The header squares switch between green, neon blue, and grey. Green is the default, and the browser remembers the selected palette when storage is available. Each palette has a zero tone and four activity tones scaled to the highest observed day for the selected metric.

Worklog counts each top-level Codex session or spawned subagent once per reporting date with observed activity. Range totals sum those daily counts. Historical coverage depends on retained metadata. Commit subjects open their exact GitHub commit when the export includes a URL. [Local API contract](docs/data-contract.md)

## Daily tokens first

The local preview of the public frontend needs substantial visual and layout work. The first task is to establish what a daily token count means and verify that Worklog can report it reliably. The merged preview has a selected-day view and a weekly recap, but neither published device feed contained `tokenDays` when checked on November 18.

- Trace one recent `America/Denver` calendar day from each device's observed Codex counter increases through the local ledger and public feed to the preview's **Observed tokens** row. Identify which collector or publisher needs updating where the field is missing.
- Check repeat refreshes, reopened sessions, and sessions that cross midnight. Reconcile each device's daily subtotal before combining them. Keep complete, partial, unavailable, and measured zero distinct.
- Measure historical coverage before deciding what to show for older dates. Keep calendar-day observations, the rolling **Last 24 hours** window, and Codex account usage separate.

Once those numbers and their coverage are understood, revisit the page hierarchy, layout, and daily readout in the local preview. The release records below describe the deployed website. [Daily token data contract](docs/data-contract.md#public-last-24-hours-projection) · [Project handoff](docs/handoff.md#next-session-priority)

## Build and publish

1. Run `pnpm --filter @agent-dashboard/website build`. Publish only `index.html`, `styles.css`, `activity.js`, `week-recap.js`, `plot-scrollbar.js`, `date-ranges.js`, `today-range.js`, `github-history.js`, `heatmap-metrics.js`, `metric-explorer.js`, `metric-series.js`, `metric-explorer.css`, `jimmyweber-skull.svg`, and `preview.png` from `apps/website/dist` to the site's `/worklog/` directory.
2. Run the local Worklog service and allow its GitHub and Codex syncs to finish. The loopback endpoint `GET /api/website` produces the public data feed.
3. The primary publisher runs `python3 apps/website/publish-activity.py SSH_ALIAS ABSOLUTE_WEB_DIRECTORY`. An additional device passes `--device DEVICE-SLUG`. The static frontend reads `activity.json` and `codex-devices.json` alongside `index.html`.

Use the site's existing explicit-file release workflow and retain the production backup. Give changed CSS and JavaScript asset references a new cache version. Verify the deployed assets and browser behavior at desktop and mobile widths. The live JSON feeds are owned by the machine publishers. Keep both out of static releases and Git.

To preview the public dashboard locally, run:

```sh
pnpm --filter @agent-dashboard/website preview
```

Open [Worklog on localhost](http://127.0.0.1:4177/worklog/). The preview builds the public frontend, serves it on loopback, and fetches both published feeds from JimmyWeber.com on demand. A visible preview tab checks for new reports every minute and reloads when either feed changes. For offline testing, serve the built files under `/worklog/` with schema-version-1 fixture feeds alongside them. Keep fixtures outside the static release file list.

The data export carries repository names, commit subjects, and GitHub commit links, including activity from private repositories, and aggregate counts. GitHub handles repository access when visitors follow a commit link. The export excludes Codex session identifiers and account details, commit bodies, and credentials. Keep the export, database, and SSH config out of Git. The host serves static files and Worklog's collectors run locally.

## Date range picker

The summary header offers 7/30/90-day, This year, All, individual month, and custom inclusive date ranges. Presets end on the latest published date, using reporting calendar dates. Apply range validates both dates and updates totals, daily or monthly chart, project history, and the metric explorer. The 90-day heatmap remains anchored to the latest report. Links preserve ranges with `range`, `start`/`end`, or the existing `month` query parameter. Monthly tokens are unavailable for ranges that cut through a reporting month; they are never prorated. Publish `date-ranges.js` along with the updated assets. Validation passed: workspace tests, type checking, production builds, and browser checks at desktop, 390 px, and 320 px. Browser checks covered a cross-month custom range, reversed-date recovery, range URLs, filtered totals and projects, explorer synchronization, and no page overflow.

## Metric explorer

Each activity total opens an animated line-chart explorer with rounded controls and smooth curves through the observed points. Curves stay within adjacent values and break at unavailable intervals. The explorer appears in place of the heatmap and bar chart. Collapse or Escape restores the mounted overview and returns focus to the selected metric. The explorer follows the selected summary date range when that period changes; otherwise it starts with all recorded history grouped by month.

Controls include a rolling 30-day preset, 3/6/12-calendar-month presets, all history, custom dates, daily/weekly/monthly grouping, chart/table views, area fill, points, and aggregate CSV download. The 30D preset includes the latest reported date and the previous 29 calendar days; longer month presets include the latest recorded month through its latest published day. Hover/touch, click-to-pin, arrow keys, and previous/next buttons inspect intervals. Range stats show observed total, average per observed interval, peak, and coverage. Project totals count distinct repositories across the range. Missing intervals remain gaps, observed zero stays zero, and intervals mixing known and unavailable days are partial. Push and Codex observations retain the existing feed coverage limits and Sync status.

Outside Today, tokens remain monthly only. In the 30D view, monthly observations appear at their reporting dates and retain their full-month values; the stats explicitly say Published month totals, since an exact 30-day token subtotal is unavailable. Custom ranges expand to whole published months, with the current month ending at the latest report. The explorer consumes the existing public feeds and adds no collector, storage, or account-limit data. CSV contains only dates, the selected aggregate, and its coverage label.

Validated locally with the published feed snapshot: all six totals matched, chart/table and export worked, empty/reversed custom dates remained recoverable, period changes and collapse preserved the overview, and keyboard/touch inspection worked. Responsive checks covered 320, 390, and 1440 px and the three existing palettes. Model tests cover missing/zero/partial values, distinct projects, Monday-based weeks, and monthly tokens. Published in `worklog-evening-20261117-01`; all three new assets are included in the release.

## Today

Today appears before 7 days and selects one exact, half-open 24-hour window shared by reporting devices. Each machine exports four aggregate snapshots ending at aligned UTC quarter hours, so independently scheduled publishers can use the latest common window. The caption shows its actual reporting times; the window is 24 elapsed hours across daylight-saving changes. The 90-day heatmap remains fixed.

Git events are filtered by their exported `occurredAt` instant before totals and project history are built. Shared events still deduplicate across devices, preserving a timestamp when one source is older. Codex agents/subagents and observed token counters come from that same window. Tokens retain the existing local-counter semantics: sessions started within the window, with trustworthy usage snapshots inside it. No sessions or account identifiers are exported. A missing or stale device report never substitutes an entire calendar day or a monthly token value. Known subtotals are qualified as partial; entirely unavailable metrics stay unavailable. The Today explorer and CSV use the same window, with UTC boundaries included in CSV.

Both MacBook Pro and Windows PC services and publishers have been updated to emit the optional `rolling24Hours` projection and Git timestamps. Existing feeds and clients remain schema-version-1 compatible. `today-range.js` is included in release `worklog-today-20261117-01`. No native UI, ledger, startup, or account-limit data changed.

## Session-end operating state — November 17, 2026

The Windows desktop was intentionally shut down after the releases and Today reporting rollout were verified. The hosted website and retained records remained available independently; offline reports may become stale and Today must qualify partial or unavailable coverage rather than invent zeros. No wake-up or overnight monitoring was requested. The local preview server was stopped, and no frontend publication remained pending.

At the November 18 closing check, Windows had resumed with its existing single service, successful scheduled publisher, durable checkout, local Git metadata, ledger, package, startup setting, and publisher identity. The current Mac freshness follow-up is recorded below. [Session handoff](docs/handoff.md#session-close--november-17-2026)

## Current publishers

- **MacBook Pro, primary.** `com.jimmyweber.worklog-service` starts the service at login. `com.jimmyweber.worklog-publish` writes `activity.json` every 15 minutes while the service is reachable. To restart the service after building, run `launchctl kickstart -k "gui/$(id -u)/com.jimmyweber.worklog-service"`. To stop publishing, unload `com.jimmyweber.worklog-publish` with `launchctl bootout` and move its plist out of `~/Library/LaunchAgents/`.
- **Windows PC, `windows-pc`.** Worklog starts at Windows sign-in. The current-user Task Scheduler job `Worklog Website Publisher (windows-pc)` runs at sign-in and every five minutes while signed in. Its script and working directory use `%LOCALAPPDATA%\WorklogPreviews\windows-all-source-20261117`, the same durable checkout as the running Windows service, built at `fc347c3`. It writes that device's entry in `codex-devices.json`. To confirm the scheduler run, use `Get-ScheduledTaskInfo -TaskName 'Worklog Website Publisher (windows-pc)'` and check `LastTaskResult` is `0`. Then confirm the corresponding source times on the site after the local collectors and publisher have both run. [Windows rollout and recovery record](apps/windows/README.md#rolling-24-hour-publisher-update-on-november-17-2026)

At the November 17 Today release verification, both machines supplied four aligned 24-hour observations and timestamped Git events. Windows was the only additional device in the live feed. Reports continue to change independently of static releases; refer to the table for current operating status. [Live Sync status](https://www.jimmyweber.com/worklog/#sync-title)

The closing read-only check on November 18 at 08:09 Denver found a healthy Windows service and successful scheduled publisher. The primary feed was last generated at 05:20 Denver and Windows at 08:06, leaving no exact overlap between their four-window sets. Check the Mac primary service and publisher from that machine next session; retain freshness and unavailable/partial reporting until matching reports resume. This is a reporting-state issue, not an unpublished frontend change.

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

The Mac mini had no feed at the session close. When it is ready:

1. Set up the [macOS source build](README.md#macos) on the Mini. Authenticate GitHub and Codex for that user, use `America/Denver`, and start one local Worklog service. Enable the packaged app's login item or use the existing macOS service launch-agent pattern. Check `http://127.0.0.1:4317/health` and let local GitHub and Codex collection finish. Local Codex reporting requires observed activity on that device.
2. Configure Python 3.8+ and the existing noninteractive SSH connection with a verified host key. From the checkout, run `python3 apps/website/publish-activity.py SSH_ALIAS ABSOLUTE_WEB_DIRECTORY --device mac-mini` using the site's configured alias and directory. Keep credentials and machine-specific connection settings in local configuration.
3. Add a per-user LaunchAgent in `~/Library/LaunchAgents/` with a distinct label such as `com.jimmyweber.worklog-publish-mac-mini`, `RunAtLoad` enabled, and `StartInterval` set to 900 seconds. Its `ProgramArguments` should contain the absolute Python path, absolute path to `publish-activity.py`, SSH alias, absolute remote web directory, `--device`, and `mac-mini` as separate entries. Validate the plist with `plutil -lint` and load it with `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jimmyweber.worklog-publish-mac-mini.plist"` if using that label.
4. Open [Sync status](https://www.jimmyweber.com/worklog/#sync-title) and verify the **Mac mini** row alongside the MacBook Pro and Windows PC. After the next scheduled run, reload the site and confirm the Mini's report times advance. Check that a commit visible on two devices appears once in History.

## Release history

Release `worklog-today-20261117-01` published source `14c7eb9` on November 17, 2026. Today appears before 7 days and shows all six metrics for the same reported 24-hour interval across devices. Git timestamp filtering, rolling Codex projections, report freshness, exact-window CSV metadata, and range/explorer synchronization are covered by 173 passing workspace tests, type checking, and builds. Six installed hashes and 22 public content/MIME/checksum assertions passed. Live browser checks verified Today ordering and URL persistence, all six totals, token-window table labeling, switching to 7 days and back, and 320/390/1440-pixel layouts. Synthetic local checks covered midnight, missing sources, observed zero, and stale reporting. Both native reporting services and publishers were updated separately while preserving one service and ledger per machine. The static release did not upload either activity feed or change native UI/startup behavior. The previous evening release and portfolio remain intact.

Release `worklog-evening-20261117-01` published dashboard source `c1f2112` on November 17, 2026. It added the date picker, metric explorer, shared series/CSV model, and persistent scrollbar modules; it replaced the main script, stylesheet, and HTML. The final approved canvas/accent scrollbar styling is included, with no custom heatmap scrollbar. Eight installed hashes and 23 public HTTP content/MIME/checksum assertions passed. Live browser checks covered all six metrics, 30D, custom/reversed ranges, chart/table/CSV, keyboard inspection and collapse, All/Both heatmap filters, scrolling, and 320/390/1440-pixel layouts with all palettes. Canonical and browser/crawler preview-image checks passed for dashboard aliases and the existing portfolio. The activity feeds, native apps, shared website code, and sitemap were outside this static release. The website operations record retains the backup and guarded rollback.

Release `worklog-all-activity-20261117-01` added `heatmap-metrics.js` and updated `activity.js` and `index.html`. All is the page-load default and sums observed commits, pushes, agents, and subagents; Both combines commits and pushes. Aggregate tests distinguish complete, partial, zero, and unavailable activity. Local browser checks covered 320 px; live checks covered 390 and 1440 px, the default selection after reload, Both totals, and unchanged selected-day details. Installed hashes, public script/image hashes, HTML markers, and link-preview metadata checks passed. Public HTML is checked by content because Cloudflare injects analytics markup; its installed checksum matches the frozen payload. The original checksum assertion and revised verification plan are retained in the website release record.

Release `worklog-multi-device-20261116-01` installed `activity.js` and `index.html` with a production backup through the website release workflow. Desktop and mobile checks verified that the live heatmap and monthly token total include the Windows PC alongside the MacBook Pro. The primary and device data files are managed by their publishers and are outside this code release.

Release `worklog-shared-github-20261116-01` added `github-history.js` and updated `activity.js` and `index.html`. Desktop and mobile checks verified the merged commit links and push totals, including the Windows ledger’s nine November 10–11 commits that were missing from the MacBook Pro feed.

Release `worklog-sync-status-20261116-02` installed the Sync status table. Browser checks verified live source timestamps, and fixture checks covered current, stale, and unavailable reports down to a 320-pixel viewport.

Release `worklog-frontend-20261116-01` updated the dashboard layout, charts, and navigation. The charts sit side by side on wide screens and stack on narrow screens. The date controls scroll within each chart, and the heatmap keeps weekday labels visible while scrolling. History and Sync status are reachable from the top navigation. Local and live Chromium checks covered 320–1440 px, month URLs, metric changes, keyboard navigation, project search, commit links, and an unavailable feed. Release `worklog-frontend-20261116-02` corrected the social preview image description. Both releases deployed only static frontend files.

Release `worklog-palettes-20261116-01` added the palette controls and five higher-contrast heatmap tones. Local and live browser checks verified palette changes, persistence, zero and unavailable days, and keyboard and touch controls at 320–1440 px. Git tag `worklog-frontend-green-20261116` identifies the previous frontend.

Release `worklog-header-mark-20261116-01` added the JimmyWeber.com skull-and-crossbones to the Worklog home link. The build packages the site's [canonical skull artwork](https://www.jimmyweber.com/assets/img/brands/JimmyTheGhost-Skull.svg), which matches the shape used by Tipoff's home link. Local and live browser checks verified the mark in all three palettes at 320–1440 px.

The site was first published in release `worklog-dashboard-20261115-01`. Release `worklog-heatmap-20261115-01` added the heatmap and clickable commit subjects. The existing [Worklog portfolio page](https://www.jimmyweber.com/pages/projects/worklog/) links to the dashboard, and the dashboard appears in the XML sitemap. Releases back up site files separately from the live activity feed.

## Rollback

The current production frontend is release `worklog-today-20261117-01`. Its guarded rollback restores `worklog-evening-20261117-01`; rolling back the evening release next restores `worklog-all-activity-20261117-01`. Older frontends ignore the optional rolling-window feed fields, so a frontend rollback does not require removing those fields or changing the reporting services. Keep the machine publishers, live feeds, native packages, startup settings, and ledgers in place during a static rollback.

Earlier checkpoints include `worklog-header-mark-20261116-01` (source `37a3bbc`) and `worklog-palettes-20261116-01`. To return to an older design, use the website's guarded release runner in reverse release order, reviewing each frozen plan and backup. Once newer releases have been unwound, rolling back the header-mark release restores the palette design without the skull; rolling back the palette release restores the single-green design. The website workspace's `PROJECTS-OPERATIONS.md` records the plans, server backups, and commands. [Single-green source checkpoint](https://github.com/jimmytheghost/worklog/tree/worklog-frontend-green-20261116)

## Link preview

`preview.png` is the existing portfolio Worklog banner center-cropped and resized with Lanczos to 1200 × 630. The initial HTML supplies the canonical URL and Open Graph and Twitter image metadata. Browser and Facebook crawler checks verified `/worklog` and `/worklog/`, the preview image MIME type and dimensions, and the release check verified its checksum. Messages rendering was outside these checks.

## Portfolio page refresh

The [Worklog project page](https://www.jimmyweber.com/pages/projects/worklog/) was updated November 17, 2026 with public-dashboard information, real overview/history screenshots, and a new green banner and social preview. Release `worklog-portfolio-20261117-01` passed live content, asset, metadata, and responsive checks. [Artwork provenance, page content, and verification](docs/portfolio-refresh.md).
