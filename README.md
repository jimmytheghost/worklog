# Agent Dashboard

A private, local-first command center for GitHub activity, Codex agents, and observed AI usage.

The durable product decisions live in:

- [`docs/product-brief.md`](docs/product-brief.md)
- [`docs/data-contract.md`](docs/data-contract.md)
- [`docs/design-direction.md`](docs/design-direction.md)
- [`docs/architecture.md`](docs/architecture.md)

## What it does

- Keeps a local SQLite ledger of commits and push activity from every repository visible to the authenticated GitHub CLI account.
- Shows a compact overview and an exhaustive, searchable monthly Work History. The overview is intentionally short; the archive does not rank projects out of view.
- Records privacy-safe local Codex session metadata and observed token counters, with repository attribution when a GitHub remote can be resolved.
- Runs as one bundled local service, with optional native macOS menu-bar access.

The app is read-only and sends no telemetry. It does not ingest source code, prompts, responses, commands, tool output, commit bodies, diffs, or file lists. Commit subjects and canonical GitHub links are retained so the ledger remains useful. Codex token totals are locally observed counters—not OpenAI billing or credit balances—and unavailable data stays visibly unavailable.

## Use it

Requirements: macOS, Node.js 24 or newer, pnpm 11, and an authenticated GitHub CLI (`gh auth login`).

Double-click `launch.command`. On first launch it installs/builds what is needed; afterward it reuses one background service at `http://127.0.0.1:4317`, refreshes automatically, and opens the dashboard. Logs live at `~/.agent-dashboard/service.log`.

For the menu-bar companion:

```sh
apps/macos/scripts/package-app.sh
open apps/macos/dist/Worklog.app
```

See [`apps/macos/README.md`](apps/macos/README.md) for native-shell details.

## Development

Requirements: Node.js 24 or newer and pnpm 11.

```sh
pnpm install
pnpm dev
```

The development dashboard runs at `http://127.0.0.1:5173`; the API remains at `http://127.0.0.1:4317`.

The first GitHub import uses the account already authenticated in `gh`:

```sh
curl --request POST http://127.0.0.1:4317/api/sync/github
```

GitHub collection walks every live branch in accessible owned, collaborator, and organization-member repositories, deduplicates commits by repository and SHA, and reads push, force-push, branch-creation, and branch-deletion activity from GitHub. The local ledger defaults to `~/.agent-dashboard/agent-dashboard.sqlite` and is excluded from the repository. GitHub's Events API is a recent-activity source, so push coverage is explicitly labeled partial rather than presented as complete history.

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
