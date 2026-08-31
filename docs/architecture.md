# Agent Dashboard Architecture

Status: Phase 2 GitHub vertical slice

## Shape

Agent Dashboard is a local TypeScript workspace with two applications and shared packages:

```text
apps/dashboard        React and Vite interface
apps/service          Fastify localhost service and collectors
packages/domain       Source-neutral events, validation, and aggregation
```

The browser interface never reads GitHub credentials, Codex state, or repositories directly. Collectors run in the local service, normalize privacy-safe metadata through the domain package, and persist it in the application database. The dashboard consumes source-qualified API responses and live update notifications.

## Runtime

- The dashboard is a desktop-first local web interface.
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

The Phase 2 service uses the durable SQLite ledger and authenticated GitHub collector in normal operation. Deterministic fixture mode remains available only for tests and deliberate development fallback.

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
- Future collector fixtures will be sanitized and versioned so upstream format changes can be detected safely.

## Directed agent workflow

Implementation proceeds in waves with exclusive directory ownership. The director freezes shared contracts, assigns bounded package work to sub-agents, integrates their changes, resolves cross-package issues, performs visual QA, and runs the full workspace validation before committing. Root configuration, lockfiles, schema boundary changes, and cross-package refactors remain director-owned.
