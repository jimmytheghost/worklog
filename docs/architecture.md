# Agent Dashboard Architecture

Status: Phase 3 GitHub and local Codex vertical slices

## Shape

Agent Dashboard is a local TypeScript workspace with two applications and shared packages:

```text
apps/dashboard        React and Vite interface
apps/service          Fastify localhost service and collectors
packages/domain       Source-neutral events, validation, and aggregation
packages/storage      SQLite event ledger and privacy-safe read models
packages/collector-github  Read-only GitHub normalization
packages/collector-codex   Experimental metadata-only local Codex adapter
```

The browser interface never reads GitHub credentials, Codex state, or repositories directly. Collectors run in the local service, normalize privacy-safe metadata through the domain package, and persist it in the application database. The dashboard consumes source-qualified API responses and live update notifications.

## Runtime

- The dashboard is a compact local interface designed to sit behind a native macOS menu-bar shell; a full Work History window exposes complete monthly records.
- The service binds to `127.0.0.1` by default.
- Server-sent events provide lightweight collector and sync updates.
- SQLite will hold the append-only event ledger, source observations, sync cursors, and rebuildable aggregates.
- Desktop packaging is deferred until the browser-based experience proves useful.

## Data flow

```text
GitHub / local Git / local Codex / optional OpenAI Usage API
                            |
                    versioned collectors
                            |
             privacy allowlist and normalization
                            |
                    append-only event ledger
                            |
               source-qualified daily aggregates
                            |
                  local API and event stream
                            |
                         dashboard
```

Raw prompts, responses, terminal commands, tool output, diffs, repository file contents, and credentials do not cross the privacy allowlist.

## Package responsibilities

### `@agent-dashboard/domain`

- Defines normalized event and metric contracts.
- Validates runtime records with strict schemas.
- Generates deterministic source-aware idempotency keys.
- Deduplicates replayed observations.
- Buckets UTC instants into configurable local calendar days.
- Keeps attribution, confidence, completeness, and freshness independent.

The package does not know about HTTP, storage, React, authentication, or source credentials.

### `@agent-dashboard/service`

- Owns configuration, API lifecycle, collectors, storage, migrations, and sync scheduling.
- Exposes health, snapshot, and live-event endpoints to the local dashboard.
- Reads source data without executing repository-owned code.
- Preserves the last successful data when a later sync fails.

The Phase 3 service uses the durable SQLite ledger, authenticated GitHub collector, and experimental local Codex collector in normal operation. Codex collection is opt-in at startup or available through an explicit sync endpoint. Deterministic fixture mode remains available only for tests and deliberate development fallback.

### `@agent-dashboard/collector-github`

- Discovers every owned public and private repository visible to the authenticated `gh` account.
- Enumerates every live branch and imports author-filtered commits, deduplicated by repository and SHA.
- Imports push, force-push, branch-creation, and branch-deletion operations from each repository's Activity history across all refs.
- Semantically deduplicates equivalent observations when old user Events and repository Activity overlap in the append-only ledger.
- Retains partial coverage labels because deleted refs and activity outside GitHub's available history cannot be reconstructed exactly.

### `@agent-dashboard/collector-codex`

- Opens known local SQLite sources read-only and parses rollout records through a strict metadata allowlist.
- Hashes workspace identities and sanitizes warnings before they leave the collector.
- Emits agent lifecycle, parent/sub-agent relationships, model/reasoning metadata, and only the latest cumulative usage observation per session.
- Treats missing counters as unknown and marks all coverage experimental, partial, and unsupported.
- Never parses or copies prompts, responses, commands, tool output, diffs, credentials, source code, or raw paths.

### `@agent-dashboard/dashboard`

- Renders Overview, Projects, Agents, Usage, and source-health views.
- Treats zero, unknown, partial, stale, and unavailable as different states.
- Provides accessible keyboard and tabular equivalents for visualizations.
- Keeps commits and pushes, as well as local Codex and official API usage, separate.

The Overview consumes the local service snapshot and retains an explicit development-only fixture fallback for disconnected UI work.

## Security boundary

- Bind only to loopback unless a future feature explicitly requires otherwise.
- Keep GitHub authentication in `gh` initially; do not copy tokens into browser storage or SQLite.
- Use read-only source access and explicitly approved local repository roots.
- Log identifiers and collector state, not sensitive payload contents.
- Add an ephemeral local session token before the service exposes real private metadata.
- Store the database in the operating system's application-data directory and support backup/export.

## Verification

- Unit tests cover schemas, idempotency, replay deduplication, and calendar boundaries.
- Service tests exercise configuration and routes through Fastify injection.
- Interface tests cover primary Overview interactions.
- Browser QA validates desktop and narrow layouts, keyboard semantics, and browser errors.
- Dashboard clients retry transient startup failures and refresh snapshots after terminal collector events.
- Sanitized, versioned collector fixtures detect required and additive upstream schema drift safely.
- Database privacy checks reject prohibited payload keys after live reconciliation.

## Directed agent workflow

Implementation proceeds in waves with exclusive directory ownership. The director freezes shared contracts, assigns bounded package work to sub-agents, integrates their changes, resolves cross-package issues, performs visual QA, and runs the full workspace validation before committing. Root configuration, lockfiles, schema boundary changes, and cross-package refactors remain director-owned.
