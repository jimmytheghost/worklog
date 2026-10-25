# Worklog workflow

After each completed change, run the relevant validation, commit the changes for that task, and push the current branch to its GitHub remote before reporting completion. The user has authorized this workflow; do not ask for confirmation each time. Preserve unrelated work, and report any commit or push failure explicitly.

# Project context

Worklog is a personal macOS menu-bar and Windows tray app shared as-is. Keep public documentation grounded in implemented behavior, with no promises of support or a release schedule. See README.md and docs/handoff.md for setup and the code map.

Preserve one local service, read-only collectors, local storage, and exhaustive monthly history. Keep commits and pushes separate. Distinguish missing, zero, partial, stale, and unavailable data. Store only the Codex metadata allowlist; never persist prompts, responses, tool output, or credentials. Keep local session counters separate from Codex account limits.

Run validation appropriate to the change. Documentation-only changes need link/content checks and `git diff --check`. Shared code checks are `pnpm test`, `pnpm typecheck`, and `pnpm build`. For macOS native changes, also run `swift test --package-path apps/macos` on macOS. For Windows native changes, also run `dotnet run --project apps/windows/Worklog.Tests --configfile apps/windows/NuGet.Config` and `dotnet build apps/windows/Worklog.App --configfile apps/windows/NuGet.Config`. Packaging instructions are in apps/macos/README.md and apps/windows/README.md. Never commit local ledgers, logs, snapshots, credentials, or generated app bundles.
