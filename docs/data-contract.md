# Worklog Data Contract

Status: Current data contract, with deferred design notes

Default local timezone: `America/Denver`

Scope: local-first, read-only collection with an allowlisted public projection

## Purpose

Worklog reports GitHub activity, observed local Codex activity and token counters, and signed-in Codex account usage facts. Local Git event collection and OpenAI organization Usage/Costs collection are deferred designs. The TypeScript domain model retains names and types for some deferred sources. A displayed number should answer four questions:

1. What does it count?
2. Which source produced it?
3. How complete is the underlying observation window?
4. How recently was it synchronized?

The SQLite ledger stores typed, allowlisted events and source coverage. The latest Codex account usage snapshot has its own table. Use the [domain schemas](../packages/domain/src/schemas.ts) and [SQLite schema](../packages/storage/src/schema.ts) for exact fields.

## Source-of-truth policy

Authority is assigned per fact, not per screen.

| Fact | Primary authority | Secondary evidence | Notes |
| --- | --- | --- | --- |
| Commit identity, parents, author time, committer time | GitHub commit API | None | The repository ID and commit SHA identify the commit. |
| Repository identity | GitHub repository ID | Local GitHub remote for Codex workspace attribution | The immutable repository ID preserves identity across renames. |
| Push occurrence | GitHub repository Activity | Signed-in user's GitHub push events where collected | Coverage is partial. Worklog counts observed operations separately from commits. |
| Branch/ref state | Latest successful source observation | None | Ref state is mutable and should be represented as a snapshot, not permanent history. |
| Codex task/session identity and hierarchy | Local Codex metadata | None | Identity and parent relationships come from observed session metadata. |
| Codex locally observed tokens | Local Codex metadata | None | This is not interchangeable with organization API usage. |
| Codex account limits, reset times, credits, and lifetime facts | Official local Codex app-server for the signed-in account | None | Latest snapshot only; account identity is hashed and credentials/email are not stored. |
| Codex session repository association | Workspace's resolved GitHub remote | None | A session stays unattributed when the remote cannot be resolved to a known repository. |
| Calendar day | Event occurrence instant converted to configured timezone | None | The original UTC instant is always preserved. |

Normalized events preserve the source, observation time, and adapter version. Project metadata, source coverage, and the current account usage snapshot can be refreshed independently.

## Metric definitions

All counts use raw event or entity counts unless the metric explicitly says otherwise. Dashboard filters must be applied before aggregation.

### Git activity

- **Commits:** distinct repository and SHA pairs whose commit author matches the signed-in GitHub account or a configured unlinked author email. Reporting uses committer time. The event payload retains author time when supplied by GitHub. A merge commit counts once, including when multiple live branches contain it.
- **Pushes:** distinct observed pushes, force pushes, branch creations, and branch deletions attributed to the configured account. A push containing several commits counts as one push.
- **Active projects and active days:** distinct repositories and local dates, respectively, with at least one recorded Git commit or push in the interval. The native summary derives these metrics from Git events.
- **Git heatmap value:** daily commits or pushes in the configured timezone. The native Both mode sums the two values for cell intensity and retains separate exact counts.

Push totals use observations from GitHub. Historical reconstruction from commit dates, reflogs, or branch state remains outside the contract.

### Codex activity

- **Agents:** distinct top-level Codex sessions observed active on a reporting date.
- **Subagents:** distinct spawned Codex sessions observed active on a reporting date. When the ledger contains both classifications for a session on the same date, subagent classification takes precedence.
- **Range totals for agents and subagents:** sum of the respective daily counts. A session active on several dates contributes once on each of those dates. Retained local records set the historical coverage.
- **Observed tokens:** available local session counters contribute to the observed subtotal. Cumulative counters use revisions and window deltas in the storage read model. Missing counters leave coverage partial or unknown. [Token read model](../packages/storage/src/storage.ts)
- The ledger can retain allowlisted task starts, session lifecycle states, and observed activity. The current overview reports daily session counts and range totals for agents and subagents.
- **Codex usage remaining:** `100 - usedPercent` for each rate-limit window returned by the signed-in account, clamped to 0–100 and paired with its source reset time.
- **Banked resets and credits:** values returned by the Codex account source. Missing is unknown, never zero.
- **Lifetime usage facts:** lifetime and peak daily tokens, streaks, and longest-running turn as returned by the Codex account source. These facts are not summed with local session counters.

### Deferred OpenAI API usage design

- **API tokens:** usage returned by official organization usage endpoints, grouped by the dimensions present in the response (for example model, project, user, or API key).
- **API cost:** currency amount returned by the official costs endpoint, preserving currency and bucket interval.

OpenAI API usage and local Codex observed usage are separate series. They must not be summed into a single total unless a later reconciliation mechanism proves the datasets are mutually exclusive and documents that proof. No monetary estimate should be generated for subscription-backed Codex usage unless a pricing and billing source explicitly supports it.

### Reporting ranges

The native summary ranges use local calendar boundaries and half-open intervals. Their end is the start of the next local day.

- `day`: today.
- `week`: today and the preceding six local dates.
- `month`: today and the preceding 29 local dates.
- `year`: the current local calendar year through today.
- `all`: all recorded dates through today.

The native heatmap uses a trailing 90-day local window independent of the summary range. The public website's 90-day window ends on the latest published reporting date and stays fixed when visitors change the history month. Monthly Work History uses a calendar month.

## Provenance, confidence, completeness, and freshness

These dimensions describe different properties and must remain independent.

### Provenance

Every normalized event includes:

- `source_system`: for example `github`, `git_local`, `codex_local`, or `openai_usage`.
- `source_account_id`: stable local reference to the configured connection/account, never a secret.
- `source_record_id`: source-native ID when available, otherwise a deterministic synthetic ID.
- `adapter_name` and `adapter_version`.
- `observed_at`: when the dashboard obtained the record.
- `source_occurred_at`: when the source says the event occurred, if known.
- `raw_record_hash`: optional hash used for change and replay auditing without retaining sensitive raw content.

### Attribution and confidence

Attribution describes who or what produced an activity record. Confidence describes the evidence supporting that classification or a relationship. They are independent fields.

| Attribution | Meaning |
| --- | --- |
| `codex` | Activity is attributed to a Codex task or session. |
| `human` | Activity is explicitly classified as human-created. |
| `unknown` | Available evidence does not support either classification. |

| Confidence | Meaning | Example |
| --- | --- | --- |
| `confirmed` | Directly stated by an authoritative source or explicit user mapping | A recorded task identifier explicitly links a commit to a Codex session. |
| `correlated` | Supported by deterministic contextual evidence but not directly asserted | Repository, branch, SHA, and time overlap associate a commit with a Codex task. |
| `unknown` | Evidence is absent, conflicting, or insufficient | A commit cannot be associated with any Codex task. |

The event or relationship records the classification method and optional reason. AI attribution must never be presented as certain when it is only temporally correlated, and `unknown` must never default to `human` or `codex`.

### Completeness

Completeness describes observation coverage for a source, metric, entity, and interval:

- `complete`: the source contract supports the full interval and all requested pages/partitions synchronized successfully.
- `partial`: some portion of the interval or result set is known to be missing.
- `prospective`: authoritative collection began at a known boundary; data before it is not claimed.
- `unavailable`: the source cannot provide this metric for the interval.
- `unknown`: coverage cannot yet be established.

Coverage records can carry a start, end, completeness, and reason. Some views return numeric summaries and expose coverage separately in the snapshot or source status. Claims about completeness should reflect the least complete contributing source and the observed repository set.

Examples:

- Imported Git history can be `complete` for reachable commits in a cloned repository while still being incomplete for deleted or never-fetched refs.
- GitHub push history initially will usually be `prospective` or `partial` because event retention is limited.
- A failed pagination request marks the affected synchronization interval `partial`, even if some events were imported.

### Freshness

Freshness is based on the last successful collection, not the last attempted collection.

- `fresh`: age is within the adapter's configured expected sync interval plus tolerance.
- `stale`: the last successful collection exceeds that threshold.
- `never`: no successful collection has occurred.

Store `last_attempted_at`, `last_succeeded_at`, and the latest error separately. A sync failure must not erase prior data, move `last_succeeded_at`, or silently change completeness to `complete`.

## Normalized event envelope

The conceptual envelope is source-neutral and append-only:

```ts
type NormalizedEvent = {
  eventId: string;                 // Stable event identifier from the adapter
  eventType: EventType;            // namespaced, version-stable semantic type
  schemaVersion: number;           // normalized payload schema version
  entityType: string;
  entityId: string;                // canonical local entity ID
  repositoryId?: string;
  taskId?: string;
  sessionId?: string;
  occurredAt: string;              // UTC ISO-8601 instant selected for chronology
  occurredAtSource: "source" | "derived" | "observed";
  observedAt: string;              // UTC ISO-8601 collection instant
  sourceSystem: "github" | "git_local" | "codex_local" | "codex_account" | "openai_usage";
  sourceAccountId: string;
  sourceRecordId: string;
  adapterName: string;
  adapterVersion: string;
  sourceFormatVersion?: string;
  idempotencyKey: string;
  attribution: "codex" | "human" | "unknown";
  confidence: "confirmed" | "correlated" | "unknown";
  completeness: "complete" | "partial" | "prospective" | "unavailable" | "unknown";
  payload: Record<string, unknown>; // event-type schema; no prompt/source contents
  rawRecordHash?: string;
};
```

All instants are stored in UTC with sufficient precision to preserve the source value. If the source has only a date or time bucket, payload metadata records that precision and the dashboard must not imply a more precise instant.

### Domain event types

The domain accepts the following event types. The active collectors emit GitHub and local Codex events. OpenAI organization and other association types remain available to the domain for deferred work.

| Event type | Canonical meaning |
| --- | --- |
| `git.commit.discovered` | A commit SHA was first normalized for a repository. Re-observation updates source observations, not the semantic event. |
| `github.push.observed` | GitHub reported a push operation, including ref and available before/after/commit information. |
| `git.ref.snapshot_observed` | A mutable ref state was observed at a point in time. |
| `repository.discovered` | A repository was first normalized from GitHub or a local checkout. |
| `repository.metadata_changed` | Source metadata changed, such as name, visibility, default branch, or archival state. |
| `codex.task.started` | A top-level task start was observed. |
| `codex.session.started` | An agent execution session start was observed. |
| `codex.session.state_observed` | An allowlisted session state was observed. |
| `codex.session.activity_observed` | A session had allowlisted activity in a UTC minute. The payload contains only its source session ID and normalized agent role. |
| `codex.subagent.spawned` | A parent/child agent relationship was observed or correlated. |
| `codex.session.completed` | A session reached a terminal state. |
| `codex.usage.recorded` | A local Codex usage counter/bucket was observed. |
| `openai.api_usage.recorded` | An official API usage bucket was observed. |
| `openai.api_cost.recorded` | An official cost bucket was observed. |
| `association.recorded` | A task/session/entity relationship or attribution was created, including method and confidence. |
| `association.corrected` | A user or stronger source superseded an earlier association/classification. |

Events are immutable. Corrections append a superseding event or update a canonical snapshot derived from observations; they do not rewrite historical evidence. Event type semantics cannot change in place. A breaking semantic change requires a new event type or normalized `schemaVersion` plus a migration/rebuild procedure.

## Conceptual entity and table model

The implemented schema stores `sources`, `projects`, `normalized_events`, `sync_cursors`, `source_coverage`, and `codex_account_state`. This design reference describes logical responsibilities, including projections and deferred concepts. [Implemented SQLite schema](../packages/storage/src/schema.ts)

- **source_accounts:** configured GitHub/OpenAI/local sources, non-secret identity, enabled state, and sync policy.
- **repositories:** canonical repository identity, GitHub ID or local namespace, current metadata, and ownership/inclusion state.
- **repository_aliases/checkouts:** historical names, remote URLs, normalized local paths, and checkout-to-repository mappings.
- **identities:** normalized person/account identities and verified aliases used for authored-commit attribution.
- **commits:** one row per repository plus commit SHA, with author/committer identities and instants. Git object facts are content-addressed.
- **pushes:** one row per observed push occurrence, including ref, before/after SHAs, deletion/force indicators when available, and source event ID.
- **push_commits:** ordered membership of commits reported by a push; completeness of the membership list is recorded.
- **codex_tasks:** top-level task identity, lifecycle fields, project/workspace association, and sanitized metadata.
- **agent_sessions:** session identity, parent session/task, model, lifecycle, and normalized outcome.
- **usage_buckets:** source-specific counters by bucket interval and dimensions. Local Codex and OpenAI API records use distinct namespaces.
- **associations:** versioned links between tasks, sessions, repositories, commits, or pushes with method, confidence, and supersession.
- **events:** immutable normalized event envelope and typed payload.
- **source_observations:** source IDs, adapter versions, hashes, collection timestamps, cursor/page context, and optional privacy-safe replay material.
- **sync_runs:** source/adapter execution status, boundaries/cursors, attempts, successes, errors, item counts, and coverage results.
- **daily_aggregates:** disposable projections keyed by local date, timezone, metric, filters/dimensions, and source coverage. They can always be rebuilt from canonical data.

Secrets and access tokens are not stored in these tables. Use the operating system credential store or the authenticated `gh` CLI context, and retain only a connection reference.

## Deduplication and idempotency

Every adapter computes a stable `idempotencyKey` before insertion. Reprocessing identical source data must not add a second semantic event or inflate any aggregate.

Logical key components are below. The implementation length-prefixes components. See the [key helpers](../packages/domain/src/idempotency.ts) and [GitHub normalizer](../packages/collector-github/src/normalize.ts) for byte-for-byte formats.

- Commit: `git.commit:{repository_id}:{sha}`.
- GitHub push: account ID plus the normalized source record ID. The repository Activity endpoint uses `activity:<id>`. Collector overlap checks also consider repository, ref, and SHAs when those facts are available. The domain's synthetic key helper is available for sources without native IDs.
- Codex task/session lifecycle: `codex.{event_kind}:{source_instance_id}:{task_or_session_id}:{source_sequence_or_state}`.
- Codex usage: `codex.usage:{source_instance_id}:{session_id}:{bucket_or_counter_revision}`.
- OpenAI usage/cost: source account plus endpoint, bucket start/end, grouping dimensions, and source result identifier or deterministic result hash.
- Repository: immutable GitHub repository ID where available; never owner/name alone.

Database uniqueness constraints enforce these keys. Insertions use a transaction and conflict-safe upsert/ignore behavior. Mutable source records are handled as follows:

1. Identical raw hash: record the successful observation if needed; do not emit a new semantic event.
2. Same source ID, changed raw hash: retain the new observation and emit a metadata/lifecycle change event if the normalized meaning changed.
3. Stronger late evidence: append a correction/supersession; do not delete the prior observation.
4. Retry after partial failure: resume from the last committed cursor/page and safely replay the boundary page.

The importer must be deterministic: the same ordered or unordered input set, adapter version, and configuration yields the same canonical entities and idempotency keys. Pagination order must not affect results.

## Timezone and day-boundary handling

- Store all exact instants in UTC.
- Default display and aggregation timezone is the IANA zone `America/Denver`, not a fixed UTC offset. This preserves daylight-saving transitions.
- Convert `occurredAt` to the configured timezone when deriving `local_date`; intervals are half-open: `[local day start, next local day start)`.
- A user timezone change rebuilds calendar aggregates; it does not alter source events.
- Git commit day uses committer time. Author time remains available in the normalized event payload.
- Push day uses the source push event instant.
- Codex task/session day uses its source lifecycle instant; if absent, a derived or observed instant is allowed but labeled via `occurredAtSource`.
- Daily agent counts derive their dates from activity observations in the configured timezone. The collector retains activity minutes from turn and token metadata and falls back to the session start if it has no finer observation.
- Usage data retains the provider's bucket boundaries. Re-bucketing is allowed only when allocation is unambiguous; otherwise the original bucket is displayed without fabricated daily precision.
- Range totals include events within the selected reporting bounds. Source timestamps remain available for diagnosis.

## Privacy and security constraints

The active collectors persist allowlisted metadata.

Must not ingest or persist:

- Codex prompt or response bodies.
- Shell command text or terminal output.
- Repository file contents, patches, or diffs.
- Commit bodies, patch contents, diffs, and file lists. A privacy-safe first-line commit subject and canonical GitHub URL are allowed.
- Environment variables, credentials, API keys, OAuth tokens, or Git credential material.
- GitHub issue, pull request, discussion, or comment bodies unless a future opt-in feature defines a separate contract.

Allowed metadata includes stable IDs, repository names/URLs, branch/ref names, commit SHAs, author identity aliases, timestamps, model names, token counters, task/session lifecycle, normalized local repository paths, and outcome/status fields. User-visible task titles may contain sensitive material and are excluded by default unless a later explicit opt-in stores a sanitized title.

Additional controls:

- Bind the local service to `127.0.0.1` by default.
- Store the SQLite database and exports with user-only filesystem permissions where supported.
- Redact credentials and sensitive query parameters from logs and errors.
- Hash workspace identifiers where the literal local path is unnecessary. Public exports omit local paths.
- Exports clearly state whether they contain private repository names, identities, or local paths.

The website feeds include repository names, commit subjects, exact Git event timestamps, and GitHub commit links, including rows for private repositories. They include daily and monthly activity and aggregate Codex usage. The publisher hashes repository and identified push IDs for public deduplication. Codex session identifiers and account details stay local. GitHub controls access when visitors follow commit links.

## GitHub, local Codex, and account usage

The UI and query layer preserve explicit source namespaces:

- GitHub describes recorded commit and push activity.
- Codex local metadata describes observed agent activity and counters on this machine/profile.
- Codex account state describes current limits and account-level usage facts for the Codex CLI's signed-in profile.
- Any future OpenAI organization Usage/Costs integration should expose its own billable or administrative usage series.

Shared timestamps and repository associations enable correlation, not equivalence. A push temporally near a Codex session is not automatically an AI push. An API token bucket is not automatically a Codex token bucket. Cross-source charts must identify each series and its coverage independently.

## Source adapter versioning

Each adapter has two versions:

- `adapterVersion`: semantic version of parsing, identity, and normalization behavior.
- `sourceFormatVersion`: detected upstream schema/build/version when available, otherwise `unknown` plus a source fingerprint.

Adapters expose a common result containing normalized records, warnings, coverage, cursor/checkpoint, and adapter/source versions. Adapter rules:

1. Reject or quarantine records that cannot be safely parsed; do not silently coerce them into zero values.
2. Preserve unknown fields only in privacy-safe raw observations, not in the normalized contract.
3. A parsing-only backward-compatible fix increments the adapter patch version.
4. A normalized mapping change increments minor or major version and requires deterministic reprocessing guidance.
5. A breaking upstream format is isolated to its adapter and sets the affected sync run to `partial` or `unavailable`; the rest of the dashboard remains usable.
6. Store adapter version on every observation and event so affected records can be found and rebuilt.
7. Adapter conformance fixtures must cover identity, time parsing, pagination replay, deduplication, missing fields, privacy redaction, and known upstream variants.

The local Codex adapter is explicitly treated as unstable because its input is not assumed to be a public compatibility contract. It must feature-detect fields, tolerate additive changes, and fail closed on content that could violate the privacy policy.

## Aggregate response contract

The domain `MetricResult` describes a single qualified metric. Native range summaries and website feeds have their own response shapes. See the [local API routes](../apps/service/src/app.ts) and [public projection](../apps/service/src/public-activity.ts) for those contracts.

```ts
type MetricResult = {
  metric: string;
  value: number | null;
  unit: "count" | "tokens" | "milliseconds" | "currency";
  interval: { start: string; end: string; timezone: string };
  dimensions: Record<string, string>;
  sourceSystems: string[];
  completeness: "complete" | "partial" | "prospective" | "unavailable" | "unknown";
  coverageStart?: string;
  coverageEnd?: string;
  coverageReason?: string;
  lastSucceededAt?: string;
  freshness: "fresh" | "stale" | "never";
};
```

`null` means unavailable or unknown. Zero means the relevant source was successfully observed with sufficient coverage and no qualifying records were found. The UI must not render `null` as `0`.

### Daily activity in the snapshot

- `GET /api/snapshot` uses schema version 1. The original `activityDays` contains Git counts for 365 dates when GitHub data is available and is empty otherwise. Existing clients can continue decoding it.
- The additive `heatmapDays` contains 90 chronological local dates when GitHub or Codex activity is available and is empty when neither source has data. Each entry has `date` as `YYYY-MM-DD` and nullable counts for `commits`, `pushes`, `agents`, and `subagents`. A Codex-only snapshot can report agent counts with unavailable Git counts. Within recorded Codex coverage, dates with no qualifying activity show zero. Dates outside coverage remain unavailable unless the ledger has observations for that date. Source freshness is still reported separately.
- macOS prefers `heatmapDays` and falls back to the last 90 entries in `activityDays` when reading an older snapshot that lacks the new array. Windows currently reads `activityDays`. Its planned migration is in the [Windows heatmap handoff](windows-heatmap-handoff.md).
- `GET /api/summary` exposes agent and subagent totals in `metrics`. `GET /api/history` exposes monthly totals and observed `agentActivity` rows. `GET /api/website` exposes the per-machine public projection consumed by the publisher.

### Public activity feeds

- `activity.json` contains the primary machine's `schemaVersion`, `generatedAt`, `timeZone`, `coverage`, and `months`. Coverage includes `commitsAt`, `pushesAt`, `agentsAt`, and `agentsFrom`. The publisher adds opaque GitHub keys by matching public rows to the local monthly history projection.
- `codex-devices.json` contains `schemaVersion`, `timeZone`, and a `devices` object indexed by stable slug. Each entry carries `generatedAt`, `syncedAt` for Codex, `agentsFrom`, Codex `months`, and `git` with `commitsAt`, `pushesAt`, and GitHub `months`. Older entries can omit `git`.
- Public commits deduplicate by repository and SHA. Identified pushes use a hashed GitHub repository activity ID. For legacy push rows with missing IDs, the merged count preserves at least the largest observation count per repository and date without summing unknown overlaps. Codex counts and observed tokens add across recording devices, with daily session deduplication performed inside each local ledger.
- Sync status compares each source timestamp with the time the page loads. A timestamp at least 35 minutes old is stale. Missing or invalid timestamps show unavailable. Report freshness and historical coverage are independent.
- Heatmap colors reflect the highest observed value within the selected metric's 90-day window. Zero, four positive levels, and unavailable hatching have distinct treatments. Select any date for its exact available counts.

## Scope and deferred decisions

- Included scope covers accessible owned, collaborator, and organization-member repositories returned for the configured GitHub account. Archived repositories are retained when discovered; collector inclusion remains explicit and testable.
- The configured personal identity may include multiple verified Git names/emails and GitHub identities.
- Polling repository Activity is the initial collection mechanism. Webhooks may improve prospective push completeness beyond the available Activity history without changing the normalized event semantics.
- One local user/profile is supported initially, while source and entity IDs remain namespaced for future multi-profile support.
- Heatmap intensity thresholds are presentation logic and not part of metric semantics.
- Cost estimation for non-API Codex usage, agent launching/control, source-code analysis, and reconstructed historical pushes are outside the current contract.

## Validation requirements

Fixtures or representative sanitized records must demonstrate:

- One commit observed on multiple GitHub branches or published by multiple enrolled machines is counted once per repository.
- One push containing multiple commits increments pushes by one and commits by the correct distinct count.
- Replaying a page or entire sync does not change totals.
- A repository rename preserves history under the immutable repository identity.
- A force push and ref deletion do not corrupt commit identity or fabricate removals.
- Parent and sub-agent sessions preserve hierarchy without storing message content.
- Missing token counter classes remain unknown rather than zero.
- Locally observed Codex counters and signed-in account limits remain separate in queries and the UI.
- Day assignment across Mountain Time daylight-saving transitions is correct.
- Day, rolling seven-day week, month, year, and all-time summary boundaries are correct.
- The trailing 90-day heatmap preserves separate counts, zero, and unavailable data in Git-only, Codex-only, and mixed snapshots.
- Partial pagination and stale sources surface their coverage/freshness state in aggregate results.
- Logs, observations, database rows, and exports contain none of the prohibited content classes.

## Public Last 24 hours projection

The optional schema-version-1 `rolling24Hours` field contains four aggregate windows ending at UTC quarter-hour boundaries (the current boundary and the previous three). Each is exactly 86,400,000 milliseconds with inclusive `start` and exclusive `end`, independent of reporting timezone and DST. A window contains only `start`, `end`, nullable observed `tokens`, `tokensKnowledge`, nullable `agents`/`subagents`, and aggregate `agentDays` (`localDate`, `agents`, `subagents`). The device publisher retains this nested allowlist. Source session IDs, prompts, responses, tool output, account facts, and credentials are excluded.

The website selects the latest shared window among fresh reporting sources. Git activity uses its normalized `occurredAt` instant; date-only legacy rows are not assigned an invented time. Missing sources and counters qualify known subtotals as partial, while wholly unknown metrics remain null. The reporting window and source freshness remain visible. Projects count distinct repositories with qualifying Git activity. Agent counts retain once-per-active-local-date-per-device semantics within the selected instant range.

Updated collectors aggregate observed increases per session and UTC minute. Reporting dates use the configured timezone. Repeated observations and refreshes must not add the same increase twice. Public month entries can include `tokenDays` with `localDate`, nullable `tokens`, and `tokensKnowledge` (complete, partial, or unknown). Only the aggregate leaves the device. Older feeds can omit this field. The rolling-window CSV includes the exact UTC boundaries. Account usage and limits have their own local projection.
