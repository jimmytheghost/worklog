# Agent Dashboard

A private, local-first command center for GitHub activity, Codex agents, and observed AI usage.

The project is currently in its definition phase. The durable product decisions live in:

- [`docs/product-brief.md`](docs/product-brief.md)
- [`docs/data-contract.md`](docs/data-contract.md)
- [`docs/design-direction.md`](docs/design-direction.md)

## Status

Phase 0: product contract, data semantics, and visual direction.

Implementation will begin with a local TypeScript application backed by SQLite. The MVP is read-only and does not send telemetry or ingest source code, prompts, or response content.
