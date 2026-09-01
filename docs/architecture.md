# Worklog Architecture

Status: implemented local-first desktop application

## Product shape

Worklog is deliberately one small system with two views:

- `apps/macos`: the primary daily surface, a native macOS menu-bar popover.
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
- Server-sent events notify clients after synchronization without polling aggressively.
- The native app caches the last successful snapshot so reopening remains useful during a transient service failure.
- The packaged native app has no Dock icon and can start the service from the repository location embedded at package time.
- `launch.command` remains the simple browser launcher and development fallback.

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
  menu-bar popover / Work History window
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

The browser dashboard provides the complete monthly archive so projects are never hidden merely because they are not among the most active. Neither client launches or controls agents.

## Reliability and security

- Loopback-only HTTP; no telemetry or cloud database.
- Read-only source adapters and idempotent synchronization.
- Last successful data survives later collector failures.
- Credentials stay with the authenticated source tooling.
- Source, freshness, and partial coverage remain distinct from numeric zero.
- Database backup/export is a local file operation.

## Verification

The workspace test suite covers contracts, storage, collectors, calendar boundaries, period summaries, service routes, SSE shutdown, and core client models. Type checking and production builds run before release checkpoints. The native release package is built, ad-hoc signed, and its property list validated by `apps/macos/scripts/package-app.sh`.
