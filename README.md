# Agent Dashboard

A private, local-first command center for GitHub activity, Codex agents, and observed AI usage.

The project is currently in its definition phase. The durable product decisions live in:

- [`docs/product-brief.md`](docs/product-brief.md)
- [`docs/data-contract.md`](docs/data-contract.md)
- [`docs/design-direction.md`](docs/design-direction.md)
- [`docs/architecture.md`](docs/architecture.md)

## Status

Phase 1: a fixture-driven Overview, shared domain contract, and loopback-only local service.

The implementation is a local TypeScript application and will use SQLite for its durable event ledger. The MVP is read-only and does not send telemetry or ingest source code, prompts, or response content.

## Development

Requirements: Node.js 24 or newer and pnpm 11.

```sh
pnpm install
pnpm dev
```

The dashboard runs at `http://127.0.0.1:5173` and the local service defaults to `http://127.0.0.1:4317`.

```sh
pnpm test
pnpm typecheck
pnpm build
```
