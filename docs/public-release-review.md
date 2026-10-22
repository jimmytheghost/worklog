# Source-sharing preparation

Reviewed October 20, 2026, starting from `72e9106`.

Applied the Agentic Toolkit's public GitHub project-page process. The initial pass prepared source sharing while the repository remained private. Public source publication was completed October 21, 2026, with Jimmy's authorization. No binary, tag, or GitHub Release was published.

## Changes

- Reworked the README around the actual app, Jimmy's CodexBar inspiration and first menu-bar app, and sharing it as-is.
- Documented prerequisites, source builds, updates, background-service behavior, personal timezone defaults, local data, and source-coverage limits.
- Added the MIT License, the Toolkit's default for an unlicensed personal tool shared for reuse and adaptation.
- Added project invariants and real validation commands to AGENTS.md.
- Excluded SQLite WAL and shared-memory sidecars alongside the existing database, log, environment, dependency, and generated-build exclusions.

## Review coverage

- Inspected tracked file inventory and all 13 reachable commits (258 unique blobs across all local refs before these changes).
- Ran focused pattern checks for GitHub/OpenAI/AWS credential formats, private-key headers, credential assignments, and absolute home paths. No credential-pattern matches were found. Home-path matches were synthetic privacy-redaction fixtures in `apps/service/test/codex-integration.test.ts`.
- Reviewed collector fixtures and runtime-file exclusions. Fixture GitHub identities refer to this project's owner; the fixtures use synthetic SHAs, example email addresses, and explicit test secret strings.
- Inspected the tracked icon preview and its generation source. Added Jimmy's supplied October 20 screenshot of the native app with his current activity and account usage, as requested. The image shows no repository names or credentials. No generated app bundle is tracked or offered as a download.
- Read existing handoff and architecture notes for current limits. This pass did not run a new defect audit or claim the app is bug-free.

Focused pattern inspection cannot establish the absence of every secret. This review covers reachable local Git history, not deleted/unreachable objects or GitHub-hosted caches.

## Validation

Documentation links, referenced source paths, fenced command blocks, and diff whitespace were checked. New SQLite sidecar exclusions were verified with `git check-ignore`. No runtime or packaging code changed, so app builds and test suites were not rerun for this documentation pass; no new app/platform validation is claimed.

## Publication boundary

The repository was private with no releases when inspected. The source is now public with the prepared README, screenshot, and MIT license. A downloadable release needs its own build, license inclusion, artifact inspection, platform validation, and clear signing/notarization notes. The current package script produces a locally tied, ad-hoc-signed app rather than a portable distribution.

## Publication verification, October 21, 2026

- Refreshed the focused history scan across all 17 reachable commits and 280 unique blobs before publication. No credential-pattern matches were found; absolute home-path matches remained synthetic privacy-test fixtures.
- `pnpm test`: 121 tests passed across the dashboard, domain, collectors, storage, and service.
- `pnpm typecheck` and `pnpm build`: passed.
- `swift test --package-path apps/macos`: exited successfully with a clean build; this toolchain printed no test execution counts, so native test execution is not claimed.
- Changed GitHub visibility to public and updated the repository description. Verified anonymous access to the repository, README, license, and screenshot.
- Left the unrelated untracked local `img/` directory out of the publication commit.
