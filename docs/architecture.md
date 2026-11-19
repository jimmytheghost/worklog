# Worklog Architecture

Status: implemented local-first desktop application with a static public view

## Product shape

Worklog uses one local service per machine for native clients and monthly history. The public static site is the sole browser dashboard and combines published projections from enrolled machines.

- `apps/macos`: the primary daily surface, a native macOS menu-bar popover.
- `apps/windows`: a native C# / WPF notification-area app using the shared service and contracts with a local ledger.
- `apps/website`: the public activity frontend and SSH publisher. The static build packages HTML, CSS, JavaScript, the header skull, and the link-preview image. The frontend reads the independently published `activity.json` and `codex-devices.json` feeds from the static web host.
- `apps/service`: one Fastify process that collects, stores, aggregates, and serves data on loopback.
- `packages/domain`: source-neutral event contracts and aggregation rules.
- `packages/storage`: the SQLite event ledger and read models.
- `packages/collector-github`: read-only GitHub normalization.
- `packages/collector-codex`: official Codex app-server account usage plus experimental, metadata-only local session normalization.

There is no fleet of background agents. The packaged app starts one production service when needed and reuses it. The native clients read the loopback API. The website reads only the published feeds.

## Runtime

- The service binds to `127.0.0.1:4317` by default.
- SQLite at `~/.agent-dashboard/agent-dashboard.sqlite` is the durable source of truth.
- The API offers server-sent refresh notifications. Windows polls snapshots on open and every 30 seconds, switching to two-second polling while collectors are running.
- Both native apps cache the last successful snapshot so reopening remains useful during a transient service failure. Windows caches only decoded display fields at `%LOCALAPPDATA%\Worklog\snapshot.json` and leaves selected-range totals unavailable until the service responds.
- The macOS app has no Dock icon; Windows uses a tray icon and a flyout that hides on focus loss. Both start or reuse the local service from the checkout recorded at package time, and both leave the service running when quit.
- Windows packaging records absolute checkout, Node, and available native Codex executable paths in `checkout.json`. The launcher checks Worklog's health identity before reusing port 4317. It starts Node without a console window and drains stdout/stderr without retaining them.
- `launch.command` starts the macOS background service.

## Data flow

```text
GitHub + Codex app-server + local Codex metadata
              |
      read-only collectors
              |
    privacy allowlist + normalization
              |
       append-only SQLite ledger
              |
              +-- loopback API --> macOS / Windows
              |
              +-- website projection --> scheduled SSH publisher --> static feeds --> public Worklog
```

Prompts, responses, terminal commands, tool output, diffs, repository contents, credentials, and commit bodies do not cross the privacy boundary. A commit's first-line subject and canonical GitHub link are allowed because they make the work ledger understandable.

## Service responsibilities

The service owns configuration, migrations, collectors, scheduling, aggregation, and graceful shutdown. Its public local API is:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process and source health |
| `GET /api/snapshot` | Current overview, the legacy Git calendar, and the 90-day `heatmapDays` projection with per-metric availability |
| `GET /api/summary?period=…` | Day, rolling week, month, year, or all-time totals and recent work |
| `GET /api/history?month=YYYY-MM` | Complete monthly work-history rows plus daily observed agent counts |
| `GET /api/website` | Allowlisted public projection for the static site's activity feed |
| `GET /api/events` | Live server-sent update stream |
| `POST /api/sync` | Refresh all enabled collectors |
| `POST /api/sync/github` | Refresh GitHub only |
| `POST /api/sync/codex` | Refresh Codex account usage and local metadata |

Closing the service explicitly closes active event streams, so relaunches do not hang behind stale connections.

## Collector boundaries

### GitHub

- Uses the authenticated `gh` CLI identity without copying its token into the app.
- Discovers accessible owned, collaborator, and organization-member repositories.
- Walks live branches and deduplicates authored commits by repository and SHA.
- Records push, force-push, branch-creation, and branch-deletion observations separately from commits.
- Labels push history partial because GitHub does not expose an unlimited historical push ledger.

### Codex

- Starts `codex app-server --stdio` on demand and reads account, rate-limit, banked-reset, and usage facts through its supported JSON-RPC surface.
- Reuses the Codex CLI's sign-in state; Worklog neither requests nor stores account credentials or email addresses.
- Persists only the latest privacy-safe account snapshot and keeps the last successful result if a later refresh fails.
- Reads known local sources in place and stores only an explicit metadata allowlist.
- Hashes workspace identities and resolves them to repositories when possible.
- Stores lifecycle/model metadata and the latest cumulative observed token counters.
- Records activity observations from allowlisted turn, token, and session metadata. The read model deduplicates each top-level session or spawned subagent per reporting date.
- Treats missing counters as unknown and labels this unsupported local format experimental and partial.
- Does not claim that locally observed tokens equal OpenAI billing or credit balances.

## Client responsibilities

The macOS popover shows account usage, range totals, recent work, and a grayscale 90-day heatmap. Its six modes are All (the default), Commit, Push, Both, Agents, and Subagents. All sums available activity across the four types. The range picker changes totals and recent work independently of the heatmap.

The Windows flyout uses a 360-unit charcoal/mint design shared with Tipoff. Six account facts use small inline pairs in two columns. Local tokens, commits, pushes, active days, and projects share a row, with agent and subagent range totals below. Its All (the default), Commit, Push, and Both heatmap modes use the nullable `heatmapDays` projection, with a Git-calendar fallback for older snapshots. Selected-day details show all four separate counts; individual Agents and Subagents modes remain pending. The gear page holds startup registration and explains local tokens and partial push and agent coverage. Windows uses an opt-in current-user Run registry entry and a session mutex for a single tray instance. [Windows heatmap handoff](windows-heatmap-handoff.md)

The loopback monthly history API provides the complete archive for its ledger, with GitHub commit links where available and daily Codex activity. The public frontend merges the published GitHub events before calculating totals, heatmaps, and project history. It adds Codex aggregates across recording devices and displays the timestamp of each machine's last reported commit, push, and Codex collection. The public feeds carry repository names, commit subjects and links, opaque GitHub deduplication keys, and aggregate Codex usage. [Website handoff](../WEBSITE-HANDOFF.md)

The public palette switch runs in the browser and stores only the palette name under `worklog.palette` in local storage. Selection works for the current page when storage is unavailable. The palette and heatmap intensity are display settings with no effect on the activity feeds or totals.

The website's Today preset uses the latest exact 24-hour interval shared by enrolled devices. Each machine publishes four overlapping observations ending at aligned UTC quarter hours. The frontend filters timestamped Git events and uses Codex aggregates from the matching interval, preserving unavailable, partial, and stale states. Calendar ranges retain their monthly token semantics; native Day remains a calendar-day range. The metric explorer and CSV follow the selected public range without changing the 90-day heatmap. [Today contract](../WEBSITE-HANDOFF.md#today)

## Reliability and security

- The local API binds to loopback by default. Each publisher reads the local API and writes its allowlisted public JSON through SSH. Additional-device writes use a lock and atomic replacement, so concurrent publishers preserve one another's entries.
- The ledger and caches stay local. Worklog uses no telemetry or cloud database.
- Read-only source adapters and idempotent synchronization.
- Last successful data survives later collector failures.
- Credentials stay with the authenticated source tooling.
- Source, freshness, and partial coverage remain distinct from numeric zero.
- Database backup/export is a local file operation.

## Verification

The workspace test suite covers contracts, storage, collectors, calendar boundaries, period summaries, service routes, SSE shutdown, and core client models. Type checking and production builds run before checkpoints. macOS packaging uses `apps/macos/scripts/package-app.sh` for the ad-hoc signed app. Windows has package-free .NET model checks and WPF builds; `apps/windows/scripts/package-app.ps1` produces an unsigned framework-dependent source build. Native packaging and UI checks run on their respective platforms; see the [Windows notes](../apps/windows/README.md) and [macOS notes](../apps/macos/README.md).
