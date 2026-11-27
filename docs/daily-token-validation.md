# Daily token pipeline validation

November 27, 2026. Base: `17dad18c7fd833fedc0e1fe07a3f060cb7496466` on remote `main`. Implementation branch: `daily-pipeline-20261127`. This is an isolated implementation and preview, pending review and rollout. No installed app, live database, service, publisher, scheduled job, or production website was changed.

## Evidence and limits

A SQLite online backup was taken through a read-only connection to the existing Mac ledger. The original had no `codex_token_minutes` table. Current source migrated only the backup. The read-only Codex collector then populated that copy; no account collector or GitHub synchronization ran. Private ledgers, snapshots, and logs remain outside Git and the static website output.

At 11:20 Denver, the collector found 823 indexed sessions, eight readable rollout files and 815 missing rollouts. It produced 90 token minute buckets, with no malformed metadata lines. Missing files limit historical reconstruction; a successful refresh cannot recover their original minute counters.

The copied ledger contains 110 activity dates beginning July 28. After collection, 85 dates have known token subtotals: three have complete represented-session evidence and 82 are partial. Another 25 dates remain unknown. Five known subtotals are zero; this does not certify that a whole device or combined day had zero usage. Source coverage remains experimental and partial even when an individual token row says `complete`.

A closed Denver day was traced directly:

| Stage | November 25 result |
| --- | --- |
| UTC bounds | `[2026-11-25T07:00:00.000Z, 2026-11-26T07:00:00.000Z)` |
| Isolated minute table | 33 rows, two sessions, 36,021,592 tokens, zero partial rows |
| `queryDailyObservedTokens` and public `tokenDays` | 36,021,592, represented-session knowledge `complete` |
| Browser combined daily panel | **36,021,592 (partial)** because Windows supplies no daily observations |

At the frozen 11:20 observation, November 27 has a partial subtotal of 13,823,679. The selected November 23–27 week shows 54,692,898 observed tokens, partial, with observations on three of five elapsed dates. November 26 displays Unavailable tokens, preserving the gap. These are observations of retained local metadata, not account usage or a claim of exhaustive device coverage.

Replaying the exact captured collector result inserted zero events (10,226 ignored), left all day counts unchanged, and produced byte-equivalent feed JSON. The initial replay before the parser fix also passed; idempotency alone does not prove correct attribution.

The fetched primary public feed was generated at 11:06 Denver on November 27 and had no `tokenDays`. The retained Windows feed was generated November 23 at 22:41 Denver and also had no `tokenDays`. Its Codex success time was 22:37. Windows was not contacted or awakened. Its current local ledger, installed backend and native checks remain unverified in this pass.

## Verified changes

- [Rollout parser](../packages/collector-codex/src/rollout.ts): exclude inherited foreign-session metadata from activity dates, parent identity, lifecycle, cumulative snapshots and minute counters. A synthetic regression fails against the base parser and passes with the fix.
- [Rolling feed](../apps/service/src/public-activity.ts): an empty interval is zero only with complete coverage spanning the entire interval. A recent partial scan without numeric evidence remains unknown. Numeric measured zero remains zero.
- [Device merge](../apps/website/src/date-ranges.js): missing expected Windows reports preserve partial daily totals, including a missing device-feed response. The same expected-device rule applies to Last 24 hours.
- [Dashboard](../apps/website/src/activity.js): separate day panel, exact token number, previous/Today/next navigation, timezone/coverage note, and weekly token subtotal with observed-day count. Calendar Today and rolling Last 24 hours remain separate. Cached older HTML tolerates the new script.
- [Preview server](../apps/website/preview.mjs): `--feed-dir` reads only explicit local snapshots, with no upstream fallback when a local device feed is absent. Private feeds stay outside `dist`.

The parser prevents new contamination; this pass does not rewrite old immutable lifecycle/activity events or claim to cleanse older ledgers of every possible bad observation.

## Repeat the isolated check

Use an independent clone outside Dropbox. Do not initialize, reset, or repair the shared checkout's Git metadata. Make an SQLite online backup through a read-only connection before opening the copy with current source. Store it in a private directory outside Git. Do not copy raw Codex transcripts into the project.

```sh
pnpm install --frozen-lockfile
pnpm --filter @agent-dashboard/service exec tsx scripts/audit-daily-tokens.ts \
  /absolute/private/ledger-copy.sqlite /absolute/private/feeds/activity.json
pnpm --filter @agent-dashboard/website build
node apps/website/preview.mjs --port 4186 --feed-dir /absolute/private/feeds
```

Use a fresh feeds directory for each run. The output must be a new file; existing output files are rejected, including symlinks, dangling symlinks and hard links. The tool validates the backup against the default live ledger, then exclusively reserves its output before opening/migrating SQLite or collecting metadata. Writes use the reserved descriptor, so a replacement output symlink cannot redirect them. Failed audits remove only their own reservation. [Output guard](../apps/service/scripts/audit-output.ts) · [Synthetic safety regressions](../apps/service/test/audit-output.test.ts).

The audit tool refuses the default live ledger as input, including symlinks and hard links to it. It collects metadata read-only, writes the provided copy, freezes one result for two refreshes, and emits aggregate diagnostics. It writes only the allowlisted public projection to the explicit output. Place a retained device projection at `feeds/codex-devices.json`, or leave it absent to exercise Unavailable Windows. Do not include these feeds in a release.

This session's preview is [localhost:4186/worklog/](http://127.0.0.1:4186/worklog/). It uses a frozen isolated Mac projection plus the retained legacy Windows feed. It is not a second collector service and does not refresh live source data automatically.

## Validation

After the output-path review fix, `pnpm test`: **186 passed** (website 44, domain 23, GitHub collector 14, storage 30, Codex collector 14, service 61). `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Tests cover reopened sessions, Denver midnight/DST bounds, replay, unknown/partial/complete/zero, legacy and absent devices, weekly recap, and local preview isolation. Ten new synthetic regressions cover direct/symlink/hard-link output aliases to both ledgers through the actual CLI, existing outputs, dangling symlinks, input aliases, replacement symlinks, file permissions, successful writes and failure cleanup. The CLI cases use deliberately invalid synthetic ledger bytes and a temporary HOME; output rejection occurs before SQLite migration, and protected bytes remain unchanged. No real ledger was used for these tests. No native files changed; Swift and Windows native checks were not rerun.

Actual Brave browser checks verified the exact November 25 count, November 26 Unavailable, November 27 Today, weekly subtotal/day coverage, day navigation, separate Today/Last 24 hours captions/counts, and stale Windows. Desktop plus emulated 390- and 320-pixel layouts were visually inspected. No application JavaScript errors appeared; the preview's root favicon request returned 404. Initial IAB access was unavailable and Safari inspection timed out; Brave completed validation.

## Layout follow-up

The monthly current-year chart is alongside the heatmap above 760 px, independently of Explore's selected date range. On narrower screens it stacks below the heatmap. Selected day and Selected week use native disclosures, closed on page load; mouse and keyboard toggling reveal the existing counts and coverage notes. Browser validation checked the desktop placement, ascending January–November bars, both default-closed panels, reopening by mouse and closing by keyboard, and a 390-pixel layout without page overflow. The same frozen feeds and historical/device limits above still apply. This changes only the local preview and task branch, not production.

## Proposed rollout and rollback (not executed)

1. Review and merge the task branch. Fetch the resulting revision into a durable independent clone outside Dropbox; run the checks above there. Record exact source and bundle hashes. Keep the currently running service and publishers unchanged until the maintenance step below.
2. Read the existing service LaunchAgent and native package's recorded root before changing any runtime path. The inspected Mac service works from the preserved Dropbox source path. Avoid migrating paths and native startup in the same release. Save the existing `apps/service/dist`, `packages/storage/drizzle`, publisher script and LaunchAgent to a private rollback directory; record ownership/modes and dependency versions. Confirm the built service's external `better-sqlite3`, `drizzle-orm`, `fastify` and `zod` resolve in that runtime. Use the existing service's Node executable for a native-binding smoke check.
3. During an approved maintenance window, stop only `com.jimmyweber.worklog-service` with `launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jimmyweber.worklog-service.plist"`. Keep the native app from relaunching it during the window. Make a new SQLite online backup and retain all ledger files. Copy the validated service bundle/map and the tracked migration directory into their existing runtime locations without using the damaged Git metadata or replacing unrelated source files. The publisher script already forwards the service's projection; no publisher schedule change is needed.
4. Start that same service with `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jimmyweber.worklog-service.plist"`. Confirm exactly one service, `GET /health`, then `POST /api/sync/codex` on `http://127.0.0.1:4317`. Check `GET /api/website` for `tokenDays`, source warnings, and a reconciled closed date. Repeat Codex sync and verify stable closed-date counts; current-day counts may grow. Allow the existing publisher's next scheduled run and verify the public feed includes the fields. Do not silently treat missing rollouts as repaired.
5. When Windows is normally available, repeat backup, implementation checks and daily reconciliation there, including the documented .NET checks and native SQLite binding check, before updating its one service. Do not wake it. Keep the combined view partial until its matching daily observations arrive. A Mac-only rollout is useful but cannot certify combined coverage.
6. Prepare the static payload listed in [Website handoff](../WEBSITE-HANDOFF.md#build-and-publish), excluding all feeds, private snapshots and ledgers. Use the website workspace's guarded release process to publish only after explicit release approval. Verify deployed hashes, exact daily count/coverage, both date controls, link metadata, and desktop/mobile rendering. That workspace was not edited in this pass.

If service validation fails, stop the new service, restore the saved bundle and migration files, then bootstrap the same LaunchAgent. The additive minute table may remain: the old service ignores it. Do not delete the live ledger or blindly overwrite new observations with the old backup. Restore the backup only after preserving the failed runtime ledger and deliberately accepting loss of observations since backup. A static rollback uses the website's guarded previous release and leaves live feeds/publishers/ledgers intact. No rollback action was needed or executed here.
