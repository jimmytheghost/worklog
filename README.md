# Worklog

A private, local-first menu-bar record of GitHub activity, projects, and Codex usage.

The durable product decisions live in:

- [`docs/product-brief.md`](docs/product-brief.md)
- [`docs/data-contract.md`](docs/data-contract.md)
- [`docs/design-direction.md`](docs/design-direction.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/handoff.md`](docs/handoff.md) — start here when continuing the project

## What it does

- Keeps a local SQLite ledger of commits and push activity from every repository visible to the authenticated GitHub CLI account.
- Shows Day, rolling Week, Month, Year, and All totals in a compact menu-bar popover.
- Includes a clickable grayscale heatmap for the trailing 90 days with Commit, Push, and Both modes.
- Keeps an exhaustive, searchable monthly Work History. The overview is intentionally short; the archive does not rank projects out of view.
- Records privacy-safe local Codex session metadata and observed token counters, with repository attribution when a GitHub remote can be resolved.
- Shows the signed-in Codex account's current rate-limit windows, reset times, lifetime token facts, credits, and available banked resets.
- Runs as one bundled local service behind a native macOS menu-bar app; the browser dashboard remains available for full history.

The app is read-only and sends no telemetry. It does not ingest source code, prompts, responses, commands, tool output, commit bodies, diffs, or file lists. Commit subjects and canonical GitHub links are retained so the ledger remains useful. Local session counters remain separate from the Codex account limits reported by the official local app-server interface, and unavailable data stays visibly unavailable.

## Use it

Requirements: macOS, Node.js 24 or newer, pnpm 11, an authenticated GitHub CLI (`gh auth login`), and a signed-in Codex CLI (`codex login`).

For the intended daily experience, package and open the native app:

```sh
apps/macos/scripts/package-app.sh
open apps/macos/dist/Worklog.app
```

The packaged app starts and reuses one background service at `http://127.0.0.1:4317`, refreshes automatically, and keeps the last successful snapshot available during a transient failure. Logs live at `~/.agent-dashboard/service.log`.

Double-click `launch.command` when you want the browser dashboard directly. On first launch it installs/builds what is needed; afterward it reuses the same service.

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

Set `CODEX_SYNC_ON_START=1` to run that import when the service starts. The same refresh also asks Codex's official local app-server for account rate limits and usage facts using the existing Codex login. Worklog never receives or stores the credential or account email; it stores only an account hash and the displayed usage snapshot. The separate local-session adapter reads local Codex formats in place, marks its coverage experimental and partial, hashes workspace identities, and stores only an explicit metadata allowlist.

```sh
pnpm test
pnpm typecheck
pnpm build
```
