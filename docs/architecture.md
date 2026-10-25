# Worklog Architecture

Status: implemented local-first desktop application

## Product shape

Worklog is deliberately one small system with two native clients and a browser archive:

- `apps/macos`: the primary daily surface, a native macOS menu-bar popover.
- `apps/windows`: a native C# / WPF notification-area app using the same service, contracts, and ledger.
- `apps/dashboard`: the fuller browser view used for monthly Work History and deeper inspection.
- `apps/service`: one Fastify process that collects, stores, aggregates, and serves data on loopback.
- `packages/domain`: source-neutral event contracts and aggregation rules.
- `packages/storage`: the SQLite event ledger and read models.
- `packages/collector-github`: read-only GitHub normalization.
- `packages/collector-codex`: official Codex app-server account usage plus experimental, metadata-only local session normalization.

There is no fleet of background agents. The packaged app starts one production service when needed and reuses it. The browser and native clients never read credentials, repositories, or Codex state directly.

## Runtime

- The service binds to `127.0.0.1:4317` by default.
- SQLite at `~/.agent-dashboard/agent-dashboard.sqlite` is the durable source of truth.
- Server-sent events notify the browser after synchronization. Windows polls snapshots on open and every 30 seconds, switching to two-second polling while collectors are running.
- Both native apps cache the last successful snapshot so reopening remains useful during a transient service failure. Windows caches only decoded display fields at `%LOCALAPPDATA%\Worklog\snapshot.json` and leaves selected-range totals unavailable until the service responds.
- The macOS app has no Dock icon; Windows uses a tray icon and a flyout that hides on focus loss. Both start or reuse the local service from the checkout recorded at package time, and both leave the service running when quit.
- Windows packaging records absolute checkout, Node, and available native Codex executable paths in `checkout.json`. The launcher checks Worklog's health identity before reusing port 4317. It starts Node without a console window and drains stdout/stderr without retaining them.
- `launch.command` remains the macOS browser launcher and development fallback.

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
       summaries + monthly history
              |
  macOS popover / Windows tray / browser Work History
```

Prompts, responses, terminal commands, tool output, diffs, repository contents, credentials, and commit bodies do not cross the privacy boundary. A commit's first-line subject and canonical GitHub link are allowed because they make the work ledger understandable.

## Service responsibilities

The service owns configuration, migrations, collectors, scheduling, aggregation, and graceful shutdown. Its public local API is:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process and source health |
| `GET /api/snapshot` | Current overview plus fixed trailing 90-day activity |
| `GET /api/summary?period=…` | Day, rolling week, month, year, or all-time totals and recent work |
| `GET /api/history?month=YYYY-MM` | Complete monthly work-history rows |
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
- Treats missing counters as unknown and labels this unsupported local format experimental and partial.
- Does not claim that locally observed tokens equal OpenAI billing or credit balances.

## Client responsibilities

The native popover is intentionally compact: Codex usage remaining, reset timing and banked resets, range selection, a grayscale 90-day commit/push heatmap, five summary metrics, recent work, refresh, and a link to Work History. The range picker changes totals and recent work; it does not change the fixed 90-day heatmap.

The Windows flyout uses a 360-unit charcoal/mint design shared with Tipoff. Six account facts use small inline label/value pairs in two columns; local tokens, commits, pushes, active days, and projects share one row. The gear page holds startup registration and the routine local-token/push-coverage explanation. Collector status, freshness, and partial coverage remain visible in the overview. Windows uses an opt-in current-user Run registry entry for startup and a session mutex for a single tray instance.

The browser dashboard provides the complete monthly archive so projects are never hidden merely because they are not among the most active. None of the clients launches or controls agents.

## Reliability and security

- Loopback-only HTTP; no telemetry or cloud database.
- Read-only source adapters and idempotent synchronization.
- Last successful data survives later collector failures.
- Credentials stay with the authenticated source tooling.
- Source, freshness, and partial coverage remain distinct from numeric zero.
- Database backup/export is a local file operation.

## Verification

The workspace test suite covers contracts, storage, collectors, calendar boundaries, period summaries, service routes, SSE shutdown, and core client models. Type checking and production builds run before checkpoints. macOS packaging uses `apps/macos/scripts/package-app.sh` for the ad-hoc signed app. Windows has package-free .NET model checks and WPF builds; `apps/windows/scripts/package-app.ps1` produces an unsigned framework-dependent source build. Native packaging and UI checks run on their respective platforms; see the [Windows notes](../apps/windows/README.md) and [macOS notes](../apps/macos/README.md).
