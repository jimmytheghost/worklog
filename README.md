# Agent Dashboard

A private, local-first command center for GitHub activity, Codex agents, and observed AI usage.

The project is currently in its definition phase. The durable product decisions live in:

- [`docs/product-brief.md`](docs/product-brief.md)
- [`docs/data-contract.md`](docs/data-contract.md)
- [`docs/design-direction.md`](docs/design-direction.md)
- [`docs/architecture.md`](docs/architecture.md)

## Status

Phase 2: a live GitHub vertical slice with durable SQLite storage, an authenticated read-only collector, and a source-qualified Overview.

The implementation is a local TypeScript application and will use SQLite for its durable event ledger. The MVP is read-only and does not send telemetry or ingest source code, prompts, or response content.

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

Set `GITHUB_SYNC_ON_START=1` when launching the workspace to refresh GitHub automatically. The local ledger defaults to `~/.agent-dashboard/agent-dashboard.sqlite` and is excluded from the repository.

```sh
pnpm test
pnpm typecheck
pnpm build
```
