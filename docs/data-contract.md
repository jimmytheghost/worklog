# Agent Dashboard Data Contract

Status: Accepted MVP contract

Default local timezone: `America/Denver`

Scope: private, local-first, read-only MVP

## Purpose

This contract defines how the dashboard collects, stores, qualifies, and reports activity from GitHub, local Git repositories, Codex, and the OpenAI Usage API. Its purpose is to ensure that every displayed number can answer four questions:

1. What does it count?
2. Which source produced it?
3. How complete is the underlying observation window?
4. How recently was it synchronized?

The normalized event ledger is the durable analytical source of truth. Source payloads may be retained as metadata for audit and replay, subject to the privacy constraints below, but UI metrics must be derived from normalized entities and events rather than directly from source-specific responses.

## Source-of-truth policy

Authority is assigned per fact, not per screen.

| Fact | Primary authority | Secondary evidence | Notes |
| --- | --- | --- | --- |
| Commit identity, parents, author time, committer time | Git object database | GitHub commit API | The commit SHA is the canonical identifier. Local and remote observations of the same SHA are one commit. |
| Repository identity | GitHub repository ID | Local remote URL | Repository renames must not create a new repository. Local-only repositories receive a namespaced local identity. |
| Push occurrence and contents | GitHub push event or future webhook | Local observation/correlation | A commit is not a push. Historical pushes may be unavailable and must never be reconstructed and labeled as observed facts. |
| Branch/ref state | Latest successful source observation | None | Ref state is mutable and should be represented as a snapshot, not permanent history. |
| Codex task/session identity and hierarchy | Local Codex metadata | Temporal correlation | Prompt or response content is not required or ingested. |
| Codex locally observed tokens | Local Codex metadata | None | This is not interchangeable with organization API usage. |
| OpenAI API usage and cost | Official OpenAI organization Usage/Costs APIs | None | Reported separately from local Codex observations. |
| Project-to-Codex association | Explicit workspace/repository identifier | Path match, then time-based correlation | Inferred associations carry a confidence classification. |
| Calendar day | Event occurrence instant converted to configured timezone | None | The original UTC instant is always preserved. |

Conflicts are not resolved by overwriting the original observation. The canonical entity stores the selected value and authority, while observations preserve their source, collection time, and adapter version so the selection can be audited or recomputed.

## Metric definitions

All counts use raw event or entity counts unless the metric explicitly says otherwise. Dashboard filters must be applied before aggregation.

### Git activity

- **Commits:** count of distinct Git commit SHAs attributed to an included repository and whose selected occurrence time falls in the interval. The default occurrence time is committer time; author time remains available for inspection. A merge commit counts as one commit. A commit visible on multiple branches or received in multiple pushes counts once.
- **Authored commits:** distinct commits whose normalized author identity matches a configured user identity. This is separate from commits merely present in an owned repository.
- **Pushes:** count of distinct observed push operations. A push containing multiple commits counts as one push. A force push and a branch/tag deletion each count as a push when the source records them as such.
- **Pushed commits:** sum of distinct commit SHAs introduced by each observed push. This metric can exceed unique commits because the same commit may be pushed to multiple repositories or refs; the UI must label it explicitly.
- **Active repositories:** distinct repositories with at least one qualifying commit, push, or associated Codex task during the interval.
- **Activity heatmap value:** selected metric aggregated into calendar days in the configured timezone. The initial selector supports `commits` and `pushes`; their scales and legends are independent.

Do not infer historical push counts from commit timestamps, reflogs, or current branch state. Such evidence may support a separately labeled estimate in a future version, but it is excluded from MVP push totals.

### Codex activity

- **Tasks:** count of distinct top-level Codex tasks whose start instant falls in the interval.
- **Agent sessions:** count of distinct Codex execution sessions, including top-level and sub-agent sessions.
- **Sub-agent sessions:** sessions with a normalized parent session or parent task relationship.
- **Active duration:** elapsed wall-clock time between recorded start and terminal instants. Open sessions use the reporting instant and are labeled active. Missing terminal records produce an unknown duration rather than an assumed value.
- **Codex observed input/output/cached/reasoning tokens:** sums of the corresponding counters available in local Codex metadata. Missing counter classes are `unknown`, not zero.
- **Task outcome:** normalized terminal state such as `completed`, `failed`, `cancelled`, `interrupted`, or `unknown`; it is not inferred from Git activity.

### OpenAI API usage

- **API tokens:** usage returned by official organization usage endpoints, grouped by the dimensions present in the response (for example model, project, user, or API key).
- **API cost:** currency amount returned by the official costs endpoint, preserving currency and bucket interval.

OpenAI API usage and local Codex observed usage are separate series. They must not be summed into a single total unless a later reconciliation mechanism proves the datasets are mutually exclusive and documents that proof. No monetary estimate should be generated for subscription-backed Codex usage unless a pricing and billing source explicitly supports it.

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

Each aggregate returns `coverage_start`, optional `coverage_end`, `completeness`, and any `coverage_reason`. Aggregating inputs with different coverage must produce the least complete defensible status and must not imply account-wide completeness from a subset of repositories.

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
  eventId: string;                 // UUID/ULID generated by the dashboard
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
  sourceSystem: "github" | "git_local" | "codex_local" | "openai_usage";
  sourceAccountId: string;
  sourceRecordId: string;
  adapterName: string;
  adapterVersion: string;
  idempotencyKey: string;
  attribution: "codex" | "human" | "unknown";
  confidence: "confirmed" | "correlated" | "unknown";
  completeness: "complete" | "partial" | "prospective" | "unavailable" | "unknown";
  payload: Record<string, unknown>; // event-type schema; no prompt/source contents
  rawRecordHash?: string;
};
```

All instants are stored in UTC with sufficient precision to preserve the source value. If the source has only a date or time bucket, payload metadata records that precision and the dashboard must not imply a more precise instant.

### Initial event types

| Event type | Canonical meaning |
| --- | --- |
| `git.commit.discovered` | A commit SHA was first normalized for a repository. Re-observation updates source observations, not the semantic event. |
| `github.push.observed` | GitHub reported a push operation, including ref and available before/after/commit information. |
| `git.ref.snapshot_observed` | A mutable ref state was observed at a point in time. |
| `repository.discovered` | A repository was first normalized from GitHub or a local checkout. |
| `repository.metadata_changed` | Source metadata changed, such as name, visibility, default branch, or archival state. |
| `codex.task.started` | A top-level task start was observed. |
| `codex.session.started` | An agent execution session start was observed. |
| `codex.subagent.spawned` | A parent/child agent relationship was observed or correlated. |
| `codex.session.completed` | A session reached a terminal state. |
| `codex.usage.recorded` | A local Codex usage counter/bucket was observed. |
| `openai.api_usage.recorded` | An official API usage bucket was observed. |
| `openai.api_cost.recorded` | An official cost bucket was observed. |
| `association.recorded` | A task/session/entity relationship or attribution was created, including method and confidence. |
| `association.corrected` | A user or stronger source superseded an earlier association/classification. |

Events are immutable. Corrections append a superseding event or update a canonical snapshot derived from observations; they do not rewrite historical evidence. Event type semantics cannot change in place. A breaking semantic change requires a new event type or normalized `schemaVersion` plus a migration/rebuild procedure.

## Conceptual entity and table model

Physical names may change during implementation, but the responsibilities remain:

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

Preferred keys:

- Commit: `git.commit:{repository_id}:{sha}`.
- GitHub push: `github.push:{source_account_id}:{github_event_id}`. If no native event ID exists, use a documented hash of repository ID, actor ID, ref, before SHA, after SHA, and source occurrence time; mark collision risk in the adapter.
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
- Git commit default day uses committer instant. Author day is an explicit alternate view.
- Push day uses the source push event instant.
- Codex task/session day uses its source lifecycle instant; if absent, a derived or observed instant is allowed but labeled via `occurredAtSource`.
- Usage data retains the provider's bucket boundaries. Re-bucketing is allowed only when allocation is unambiguous; otherwise the original bucket is displayed without fabricated daily precision.
- Future-dated or severely skewed source timestamps are preserved, flagged, and excluded only by an explicit data-quality rule visible to the user.

## Privacy and security constraints

The MVP collects metadata needed for analytics and no more.

Must not ingest or persist:

- Codex prompt or response bodies.
- Shell command text or terminal output.
- Repository file contents, patches, or diffs.
- Commit patch contents; commit subjects/bodies are excluded by default.
- Environment variables, credentials, API keys, OAuth tokens, or Git credential material.
- GitHub issue, pull request, discussion, or comment bodies unless a future opt-in feature defines a separate contract.

Allowed metadata includes stable IDs, repository names/URLs, branch/ref names, commit SHAs, author identity aliases, timestamps, model names, token counters, task/session lifecycle, normalized local repository paths, and outcome/status fields. User-visible task titles may contain sensitive material and are excluded by default unless a later explicit opt-in stores a sanitized title.

Additional controls:

- Bind the local service to `127.0.0.1` by default.
- Store the SQLite database and exports with user-only filesystem permissions where supported.
- Redact credentials and sensitive query parameters from logs and errors.
- Hash local paths for telemetry/export when the literal path is not necessary; never transmit local paths without opt-in.
- Exports clearly state whether they contain private repository names, identities, or local paths.
- Deletion and retention policies operate per source account and can rebuild projections after removal.

## GitHub, Codex, and OpenAI usage separation

The UI and query layer preserve explicit source namespaces:

- GitHub/local Git describe software activity.
- Codex local metadata describes observed agent activity and counters on this machine/profile.
- OpenAI organization APIs describe billable/administrative API usage available to the connected organization.

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

Every user-visible metric response should include, conceptually:

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

## MVP assumptions and deferred decisions

- Included scope defaults to repositories owned by the configured GitHub account; forks, organization repositories, and collaborator repositories require explicit inclusion rules later.
- The configured personal identity may include multiple verified Git names/emails and GitHub identities.
- Polling is the initial collection mechanism. Webhooks may improve prospective push completeness later without changing the normalized event semantics.
- One local user/profile is supported initially, while source and entity IDs remain namespaced for future multi-profile support.
- Heatmap intensity thresholds are presentation logic and not part of metric semantics.
- Cost estimation for non-API Codex usage, agent launching/control, source-code analysis, and reconstructed historical pushes are outside the MVP contract.

## Validation requirements

Before Phase 0 exits, fixtures or representative sanitized records should demonstrate:

- One commit observed locally and through GitHub is counted once.
- One push containing multiple commits increments pushes by one and commits by the correct distinct count.
- Replaying a page or entire sync does not change totals.
- A repository rename preserves history under the immutable repository identity.
- A force push and ref deletion do not corrupt commit identity or fabricate removals.
- Parent and sub-agent sessions preserve hierarchy without storing message content.
- Missing token counter classes remain unknown rather than zero.
- Local Codex usage and OpenAI API usage remain separate in queries and charts.
- Day assignment across Mountain Time daylight-saving transitions is correct.
- Partial pagination and stale sources surface their coverage/freshness state in aggregate results.
- Logs, observations, database rows, and exports contain none of the prohibited content classes.
