# Agent Dashboard

A private, local-first command center for GitHub activity, Codex agents, and observed AI usage.

The durable product decisions live in:

- [`docs/product-brief.md`](docs/product-brief.md)
- [`docs/data-contract.md`](docs/data-contract.md)
- [`docs/design-direction.md`](docs/design-direction.md)
- [`docs/architecture.md`](docs/architecture.md)

## Status

Phase 3: live GitHub activity plus an experimental, metadata-only local Codex activity collector, backed by a durable SQLite ledger and a source-qualified Overview.

The implementation is a local TypeScript application. The MVP is read-only and does not send telemetry or ingest source code, prompts, response content, commands, tool output, or diffs. Codex token totals are locally observed cumulative counters—not billing usage—and may be incomplete.

## Development

Requirements: Node.js 24 or newer and pnpm 11.

```sh
pnpm install
pnpm dev
```

The dashboard runs at `http://127.0.0.1:5173` and the local service defaults to `http://127.0.0.1:4317`.

The first GitHub import uses the account already authenticated in `gh`:

```sh
curl --request POST http://127.0.0.1:4317/api/sync/github
```

GitHub collection walks every live branch in every owned repository, deduplicates commits by repository and SHA, and reads push, force-push, branch-creation, and branch-deletion activity from GitHub. Set `GITHUB_SYNC_ON_START=1` when launching the workspace to refresh GitHub automatically. The local ledger defaults to `~/.agent-dashboard/agent-dashboard.sqlite` and is excluded from the repository.

On macOS, double-click `launch.command` to install missing dependencies, run both applications, refresh GitHub and Codex, wait for the live snapshot, and open the dashboard.

Import privacy-safe metadata from the local Codex installation:

```sh
curl --request POST http://127.0.0.1:4317/api/sync/codex
```

Set `CODEX_SYNC_ON_START=1` to run that import when the service starts. This adapter reads local Codex formats in place, marks its coverage experimental and partial, hashes workspace identities, and stores only an explicit metadata allowlist. It is intentionally isolated because those local formats are not a supported public API.

```sh
pnpm test
pnpm typecheck
pnpm build
```
