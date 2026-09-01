import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TIME_ZONE,
  aggregateEventsByLocalDay,
  parseNormalizedEvent,
  utcRangeForLocalDate,
  type AnyNormalizedEvent,
  type CumulativeCodexUsagePayload,
  type Freshness,
  type NormalizedEvent,
  type UnavailableCumulativeCodexUsagePayload,
} from "@agent-dashboard/domain";
import BetterSqlite3 from "better-sqlite3";
import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { normalizedEvents, projects, sourceCoverage, sources, syncCursors } from "./schema.js";
import { buildCodexReadModels } from "./codex-read-models.js";
import type {
  CodexSessionReadModel,
  CodexTaskReadModel,
  CodexObservedTokenQuery,
  CodexObservedTokenResult,
  DailyGitActivity,
  DailyGitActivityQuery,
  GitActivityEventQuery,
  ProjectInput,
  ProjectSummary,
  SourceCoverageInput,
  SourceCoverageResult,
  SourceInput,
  SyncCursorInput,
} from "./types.js";

const defaultMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
export const MAX_RECENT_EVENTS_LIMIT = 500;
export const MAX_CODEX_READ_MODEL_LIMIT = 500;
const MAX_CODEX_RECONSTRUCTION_EVENTS = 10_000;

type CumulativeUsageEvent = NormalizedEvent<"codex.usage.recorded"> & {
  payload: CumulativeCodexUsagePayload | UnavailableCumulativeCodexUsagePayload;
};
type CommitEvent = NormalizedEvent<"git.commit.discovered">;
type PushEvent = NormalizedEvent<"github.push.observed">;

function deduplicateCommits(events: readonly AnyNormalizedEvent[]): CommitEvent[] {
  const unique = new Map<string, CommitEvent>();
  for (const event of events) {
    if (event.eventType !== "git.commit.discovered") continue;
    const semanticKey =
      event.repositoryId === undefined
        ? `idempotency:${event.idempotencyKey}`
        : JSON.stringify([event.repositoryId, event.payload.sha]);
    if (!unique.has(semanticKey)) unique.set(semanticKey, event);
  }
  return [...unique.values()];
}

function isRepositoryActivityPush(event: PushEvent): boolean {
  return event.sourceRecordId.startsWith("activity:") || event.entityId.includes(":github-activity:");
}

function comparePushObservations(left: PushEvent, right: PushEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId);
}

function shouldReplaceActivityAlias(current: PushEvent, candidate: PushEvent): boolean {
  const currentNamespaced = current.sourceRecordId.startsWith("activity:");
  const candidateNamespaced = candidate.sourceRecordId.startsWith("activity:");
  if (currentNamespaced !== candidateNamespaced) return candidateNamespaced;
  if (current.observedAt !== candidate.observedAt) return candidate.observedAt > current.observedAt;
  return candidate.eventId > current.eventId;
}

function collapseRepositoryActivityAliases(events: readonly PushEvent[]): PushEvent[] {
  const unique = new Map<string, PushEvent>();
  for (const event of events) {
    const current = unique.get(event.entityId);
    if (current === undefined || shouldReplaceActivityAlias(current, event)) {
      unique.set(event.entityId, event);
    }
  }
  return [...unique.values()];
}

function unmatchedLegacyObservations(activity: readonly PushEvent[], legacy: readonly PushEvent[]): PushEvent[] {
  const unmatched = [...legacy].sort(comparePushObservations);
  for (const canonical of [...activity].sort(comparePushObservations)) {
    if (unmatched.length === 0) break;
    const canonicalTime = Date.parse(canonical.occurredAt);
    let nearestIndex = 0;
    let nearestDistance = Math.abs(Date.parse(unmatched[0]!.occurredAt) - canonicalTime);
    for (let index = 1; index < unmatched.length; index += 1) {
      const distance = Math.abs(Date.parse(unmatched[index]!.occurredAt) - canonicalTime);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    unmatched.splice(nearestIndex, 1);
  }
  return unmatched;
}

function deduplicatePushes(events: readonly AnyNormalizedEvent[]): PushEvent[] {
  const transitions = new Map<string, { activity: PushEvent[]; legacy: PushEvent[] }>();
  const fallback = new Map<string, PushEvent>();
  const pushes = events.filter((event): event is PushEvent => event.eventType === "github.push.observed");
  const activity = collapseRepositoryActivityAliases(pushes.filter(isRepositoryActivityPush));
  const legacy = pushes.filter((event) => !isRepositoryActivityPush(event));
  for (const event of [...activity, ...legacy]) {
    // Endpoint-specific event IDs and entity prefixes are observations, not push identity.
    // Endpoint timestamps can also differ, so a known ref transition is the stable identity.
    // `forced` and `deleted` are deliberately excluded: one endpoint may omit those flags.
    const beforeSha = event.payload.beforeSha?.toLowerCase() ?? null;
    const afterSha = event.payload.afterSha?.toLowerCase() ?? null;
    if (event.repositoryId === undefined || (beforeSha === null && afterSha === null)) {
      const fallbackKey =
        event.repositoryId === undefined
          ? `idempotency:${event.idempotencyKey}`
          : JSON.stringify([event.repositoryId, event.payload.ref, event.occurredAt]);
      if (!fallback.has(fallbackKey)) fallback.set(fallbackKey, event);
      continue;
    }

    const transitionKey = JSON.stringify([event.repositoryId, event.payload.ref, beforeSha, afterSha]);
    const group = transitions.get(transitionKey) ?? { activity: [], legacy: [] };
    group[isRepositoryActivityPush(event) ? "activity" : "legacy"].push(event);
    transitions.set(transitionKey, group);
  }

  const reconciled = [...fallback.values()];
  for (const { activity, legacy } of transitions.values()) {
    if (activity.length === 0) {
      reconciled.push(...legacy);
      continue;
    }
    // Activity timestamps are canonical for the observations found by both endpoints.
    reconciled.push(...activity);
    if (legacy.length > activity.length) {
      reconciled.push(...unmatchedLegacyObservations(activity, legacy));
    }
  }
  return reconciled;
}

function isCumulativeUsageEvent(event: AnyNormalizedEvent): event is CumulativeUsageEvent {
  return event.eventType === "codex.usage.recorded" && "counterKind" in event.payload;
}

function shouldReplaceCumulativeUsage(
  current: CumulativeUsageEvent | undefined,
  candidate: CumulativeUsageEvent,
): boolean {
  if (current === undefined) return true;
  const candidateBucketEnd = Date.parse(candidate.payload.bucketEnd);
  const currentBucketEnd = Date.parse(current.payload.bucketEnd);
  if (candidateBucketEnd !== currentBucketEnd) return candidateBucketEnd > currentBucketEnd;
  if (candidate.observedAt !== current.observedAt) return candidate.observedAt > current.observedAt;
  const candidateUnavailable = candidate.payload.countersAvailable === false;
  const currentUnavailable = current.payload.countersAvailable === false;
  if (candidateUnavailable !== currentUnavailable) return candidateUnavailable;
  return candidate.eventId > current.eventId;
}

function nowUtc(): string {
  return new Date().toISOString();
}

function assertUtcInstant(value: string | undefined, field: string): void {
  if (value === undefined) return;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !value.endsWith("Z")) {
    throw new RangeError(`${field} must be a UTC ISO-8601 instant`);
  }
}

function assertEventUsesUtc(event: AnyNormalizedEvent): void {
  assertUtcInstant(event.occurredAt, "event.occurredAt");
  assertUtcInstant(event.observedAt, "event.observedAt");

  switch (event.eventType) {
    case "git.commit.discovered":
      assertUtcInstant(event.payload.authorOccurredAt, "event.payload.authorOccurredAt");
      assertUtcInstant(event.payload.committerOccurredAt, "event.payload.committerOccurredAt");
      break;
    case "codex.usage.recorded":
      assertUtcInstant(event.payload.bucketStart, "event.payload.bucketStart");
      assertUtcInstant(event.payload.bucketEnd, "event.payload.bucketEnd");
      break;
    case "openai.api_usage.recorded":
    case "openai.api_cost.recorded":
      assertUtcInstant(event.payload.bucketStart, "event.payload.bucketStart");
      assertUtcInstant(event.payload.bucketEnd, "event.payload.bucketEnd");
      break;
    default:
      break;
  }
}

function nextLocalDate(localDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null) throw new RangeError(`Invalid local date: ${localDate}`);
  const date = new Date(Date.UTC(Number(match[1]!), Number(match[2]!) - 1, Number(match[3]!) + 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function freshnessFor(
  lastSucceededAt: string | undefined,
  expectedSyncIntervalMs: number | undefined,
  asOf: Date,
): Freshness {
  if (lastSucceededAt === undefined) return "never";
  if (expectedSyncIntervalMs === undefined) return "fresh";
  return asOf.getTime() - Date.parse(lastSucceededAt) <= expectedSyncIntervalMs ? "fresh" : "stale";
}

function storedEventToNormalizedEvent(
  row: typeof normalizedEvents.$inferSelect,
): AnyNormalizedEvent {
  return parseNormalizedEvent({
    eventId: row.eventId,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    entityType: row.entityType,
    entityId: row.entityId,
    ...(row.repositoryId === null ? {} : { repositoryId: row.repositoryId }),
    ...(row.taskId === null ? {} : { taskId: row.taskId }),
    ...(row.sessionId === null ? {} : { sessionId: row.sessionId }),
    occurredAt: row.occurredAt,
    occurredAtSource: row.occurredAtSource,
    observedAt: row.observedAt,
    sourceSystem: row.sourceSystem,
    sourceAccountId: row.sourceAccountId,
    sourceRecordId: row.sourceRecordId,
    adapterName: row.adapterName,
    adapterVersion: row.adapterVersion,
    ...(row.sourceFormatVersion === null ? {} : { sourceFormatVersion: row.sourceFormatVersion }),
    idempotencyKey: row.idempotencyKey,
    attribution: row.attribution,
    confidence: row.confidence,
    completeness: row.completeness,
    payload: JSON.parse(row.payloadJson),
    ...(row.rawRecordHash === null ? {} : { rawRecordHash: row.rawRecordHash }),
  });
}

function assertCodexReadLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CODEX_READ_MODEL_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_CODEX_READ_MODEL_LIMIT}`);
  }
}

export interface OpenStorageOptions {
  filename: string;
  migrationsFolder?: string | undefined;
}

export class Storage {
  readonly sqlite: BetterSqlite3.Database;
  readonly db: BetterSQLite3Database;
  #closed = false;

  constructor(options: OpenStorageOptions) {
    this.sqlite = new BetterSqlite3(options.filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("journal_mode = WAL");
    this.db = drizzle(this.sqlite);
    migrate(this.db, { migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder });
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): void {
    if (this.#closed) return;
    this.sqlite.close();
    this.#closed = true;
  }

  upsertSource(input: SourceInput, at = nowUtc()) {
    const row = { ...input, displayName: input.displayName ?? null, createdAt: at, updatedAt: at };
    this.db
      .insert(sources)
      .values(row)
      .onConflictDoUpdate({
        target: [sources.system, sources.immutableSourceId],
        set: { displayName: row.displayName, updatedAt: at },
      })
      .run();

    return this.db
      .select()
      .from(sources)
      .where(and(eq(sources.system, input.system), eq(sources.immutableSourceId, input.immutableSourceId)))
      .get();
  }

  upsertProject(input: ProjectInput, at = nowUtc()) {
    const mutable = {
      name: input.name,
      owner: input.owner ?? null,
      defaultBranch: input.defaultBranch ?? null,
      visibility: input.visibility ?? "unknown",
      archived: input.archived ?? false,
      updatedAt: at,
    };
    this.db
      .insert(projects)
      .values({
        id: input.id,
        sourceId: input.sourceId,
        immutableSourceId: input.immutableSourceId,
        ...mutable,
        createdAt: at,
      })
      .onConflictDoUpdate({
        target: [projects.sourceId, projects.immutableSourceId],
        set: mutable,
      })
      .run();

    return this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.sourceId, input.sourceId),
          eq(projects.immutableSourceId, input.immutableSourceId),
        ),
      )
      .get();
  }

  listProjects(): ProjectSummary[] {
    return this.db
      .select({
        id: projects.id,
        name: projects.name,
        owner: projects.owner,
        defaultBranch: projects.defaultBranch,
        visibility: projects.visibility,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .orderBy(asc(projects.name), asc(projects.id))
      .all()
      .map((project) => ({
        ...project,
        visibility: project.visibility as ProjectSummary["visibility"],
      }));
  }

  insertEvents(inputs: readonly unknown[]): { inserted: number; ignored: number } {
    // Validate the complete batch before opening the write transaction.
    const events = inputs.map(parseNormalizedEvent);
    events.forEach(assertEventUsesUtc);
    let inserted = 0;

    this.db.transaction((transaction) => {
      for (const event of events) {
        const result = transaction
          .insert(normalizedEvents)
          .values({
            eventId: event.eventId,
            eventType: event.eventType,
            schemaVersion: event.schemaVersion,
            entityType: event.entityType,
            entityId: event.entityId,
            repositoryId: event.repositoryId ?? null,
            taskId: event.taskId ?? null,
            sessionId: event.sessionId ?? null,
            occurredAt: event.occurredAt,
            occurredAtSource: event.occurredAtSource,
            observedAt: event.observedAt,
            sourceSystem: event.sourceSystem,
            sourceAccountId: event.sourceAccountId,
            sourceRecordId: event.sourceRecordId,
            adapterName: event.adapterName,
            adapterVersion: event.adapterVersion,
            sourceFormatVersion: event.sourceFormatVersion ?? null,
            idempotencyKey: event.idempotencyKey,
            attribution: event.attribution,
            confidence: event.confidence,
            completeness: event.completeness,
            payloadJson: JSON.stringify(event.payload),
            rawRecordHash: event.rawRecordHash ?? null,
          })
          .onConflictDoNothing({ target: normalizedEvents.idempotencyKey })
          .run();
        // Replayed local Codex records may gain a trustworthy project association after
        // GitHub/local-Git reconciliation. Enrich that nullable link without counting the
        // replay as a newly inserted event or mutating historical event identity.
        if (result.changes === 0 && event.repositoryId !== undefined) {
          transaction
            .update(normalizedEvents)
            .set({ repositoryId: event.repositoryId })
            .where(and(
              eq(normalizedEvents.idempotencyKey, event.idempotencyKey),
              isNull(normalizedEvents.repositoryId),
            ))
            .run();
        }
        if (
          result.changes === 0 &&
          (event.eventType === "git.commit.discovered" || event.eventType === "github.push.observed")
        ) {
          // Adapter upgrades may add privacy-safe descriptive metadata (commit subject/URL
          // or push kind) to an event whose identity is already in the ledger.
          transaction
            .update(normalizedEvents)
            .set({ payloadJson: JSON.stringify(event.payload) })
            .where(eq(normalizedEvents.idempotencyKey, event.idempotencyKey))
            .run();
        }
        inserted += result.changes;
      }
    });

    return { inserted, ignored: events.length - inserted };
  }

  listRecentEvents(limit: number): AnyNormalizedEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECENT_EVENTS_LIMIT) {
      throw new RangeError(`limit must be an integer between 1 and ${MAX_RECENT_EVENTS_LIMIT}`);
    }

    return this.db
      .select()
      .from(normalizedEvents)
      .orderBy(desc(normalizedEvents.occurredAt), desc(normalizedEvents.eventId))
      .limit(limit)
      .all()
      .map(storedEventToNormalizedEvent);
  }

  /** Returns semantically deduplicated commit and push activity for a bounded period. */
  listGitActivityEvents(query: GitActivityEventQuery): AnyNormalizedEvent[] {
    assertUtcInstant(query.start, "start");
    assertUtcInstant(query.end, "end");
    if (Date.parse(query.end) <= Date.parse(query.start)) {
      throw new RangeError("end must be after start for a half-open UTC interval");
    }
    if (query.repositoryIds !== undefined && query.repositoryIds.length === 0) return [];

    const predicates = [
      inArray(normalizedEvents.eventType, ["git.commit.discovered", "github.push.observed"]),
      gte(normalizedEvents.occurredAt, query.start),
      lt(normalizedEvents.occurredAt, query.end),
    ];
    if (query.repositoryIds !== undefined) {
      predicates.push(inArray(normalizedEvents.repositoryId, [...query.repositoryIds]));
    }

    const events = this.db
      .select()
      .from(normalizedEvents)
      .where(and(...predicates))
      .all()
      .map(storedEventToNormalizedEvent);
    return [
      ...deduplicateCommits(events),
      ...deduplicatePushes(events),
    ].sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || right.eventId.localeCompare(left.eventId),
    );
  }

  listRecentCodexSessions(limit: number): CodexSessionReadModel[] {
    assertCodexReadLimit(limit);
    return buildCodexReadModels(this.loadCodexEvents()).sessions.slice(0, limit);
  }

  listRecentCodexTasks(limit: number): CodexTaskReadModel[] {
    assertCodexReadLimit(limit);
    return buildCodexReadModels(this.loadCodexEvents()).tasks.slice(0, limit);
  }

  queryCodexObservedTokens(query: CodexObservedTokenQuery): CodexObservedTokenResult {
    assertUtcInstant(query.start, "start");
    assertUtcInstant(query.end, "end");
    if (Date.parse(query.end) <= Date.parse(query.start)) {
      throw new RangeError("end must be after start for a half-open UTC interval");
    }

    if (query.repositoryIds !== undefined && query.repositoryIds.length === 0) {
      return { knownSubtotal: 0, knowledge: "complete", sessionsObserved: 0, sessionsKnown: 0, sessionsUnknown: 0 };
    }
    const startPredicates = [
      eq(normalizedEvents.eventType, "codex.session.started"),
      gte(normalizedEvents.occurredAt, query.start),
      lt(normalizedEvents.occurredAt, query.end),
    ];
    if (query.repositoryIds !== undefined) {
      startPredicates.push(inArray(normalizedEvents.repositoryId, [...query.repositoryIds]));
    }
    const startRows = this.db
      .select()
      .from(normalizedEvents)
      .where(and(...startPredicates))
      .all();
    const starts = startRows.map(storedEventToNormalizedEvent).filter(
      (event): event is Extract<AnyNormalizedEvent, { eventType: "codex.session.started" }> =>
        event.eventType === "codex.session.started",
    );
    const stableSessionIds = new Set(starts.map((event) => event.sessionId ?? event.entityId));
    const sourceToStableSessionId = new Map(
      starts.map((event) => [event.payload.sourceSessionId, event.sessionId ?? event.entityId]),
    );
    if (stableSessionIds.size === 0) {
      return {
        knownSubtotal: 0,
        knowledge: "complete",
        sessionsObserved: 0,
        sessionsKnown: 0,
        sessionsUnknown: 0,
      };
    }

    const usageRows = this.db
      .select()
      .from(normalizedEvents)
      .where(
        and(
          eq(normalizedEvents.eventType, "codex.usage.recorded"),
          lt(normalizedEvents.occurredAt, query.end),
        ),
      )
      .all();
    const latestBySession = new Map<string, CumulativeUsageEvent>();
    for (const parsed of usageRows.map(storedEventToNormalizedEvent)) {
      if (!isCumulativeUsageEvent(parsed)) continue;
      const sessionId =
        parsed.sessionId !== undefined && stableSessionIds.has(parsed.sessionId)
          ? parsed.sessionId
          : sourceToStableSessionId.get(parsed.payload.sourceSessionId);
      if (sessionId === undefined || !stableSessionIds.has(sessionId)) continue;
      if (
        Date.parse(parsed.payload.bucketEnd) < Date.parse(query.start) ||
        Date.parse(parsed.payload.bucketEnd) >= Date.parse(query.end)
      ) {
        continue;
      }
      const current = latestBySession.get(sessionId);
      if (shouldReplaceCumulativeUsage(current, parsed)) latestBySession.set(sessionId, parsed);
    }

    let knownSubtotal = 0;
    let sessionsKnown = 0;
    for (const sessionId of stableSessionIds) {
      const usage = latestBySession.get(sessionId);
      if (usage === undefined || usage.payload.countersAvailable === false) continue;
      knownSubtotal += usage.payload.totalTokens;
      sessionsKnown += 1;
    }
    const sessionsObserved = stableSessionIds.size;
    const sessionsUnknown = sessionsObserved - sessionsKnown;
    return {
      knownSubtotal,
      knowledge:
        sessionsUnknown === 0 ? "complete" : sessionsKnown === 0 ? "unknown" : "partial",
      sessionsObserved,
      sessionsKnown,
      sessionsUnknown,
    };
  }

  private loadCodexEvents(): AnyNormalizedEvent[] {
    return this.db
      .select()
      .from(normalizedEvents)
      .where(
        inArray(normalizedEvents.eventType, [
          "codex.task.started",
          "codex.session.started",
          "codex.session.state_observed",
          "codex.subagent.spawned",
          "codex.session.completed",
          "codex.usage.recorded",
        ]),
      )
      .orderBy(desc(normalizedEvents.occurredAt), desc(normalizedEvents.eventId))
      .limit(MAX_CODEX_RECONSTRUCTION_EVENTS)
      .all()
      .map(storedEventToNormalizedEvent);
  }

  setSyncCursor(input: SyncCursorInput, at = nowUtc()): void {
    const cursorJson = JSON.stringify(input.cursor);
    this.db
      .insert(syncCursors)
      .values({ ...input, cursorJson, updatedAt: at })
      .onConflictDoUpdate({
        target: [syncCursors.sourceId, syncCursors.adapterName],
        set: { cursorJson, updatedAt: at },
      })
      .run();
  }

  getSyncCursor(sourceId: string, adapterName: string): unknown | undefined {
    const row = this.db
      .select({ cursorJson: syncCursors.cursorJson })
      .from(syncCursors)
      .where(and(eq(syncCursors.sourceId, sourceId), eq(syncCursors.adapterName, adapterName)))
      .get();
    return row === undefined ? undefined : JSON.parse(row.cursorJson);
  }

  upsertCoverage(input: SourceCoverageInput, at = nowUtc()): void {
    assertUtcInstant(input.coverageStart, "coverageStart");
    assertUtcInstant(input.coverageEnd, "coverageEnd");
    assertUtcInstant(input.lastAttemptedAt, "lastAttemptedAt");
    assertUtcInstant(input.lastSucceededAt, "lastSucceededAt");
    const row = {
      ...input,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      coverageStart: input.coverageStart ?? null,
      coverageEnd: input.coverageEnd ?? null,
      coverageReason: input.coverageReason ?? null,
      lastAttemptedAt: input.lastAttemptedAt ?? null,
      lastSucceededAt: input.lastSucceededAt ?? null,
      latestError: input.latestError ?? null,
      expectedSyncIntervalMs: input.expectedSyncIntervalMs ?? null,
      updatedAt: at,
    };
    this.db
      .insert(sourceCoverage)
      .values(row)
      .onConflictDoUpdate({ target: sourceCoverage.coverageKey, set: row })
      .run();
  }

  getCoverage(coverageKey: string, asOf = new Date()): SourceCoverageResult | undefined {
    const row = this.db.select().from(sourceCoverage).where(eq(sourceCoverage.coverageKey, coverageKey)).get();
    if (row === undefined) return undefined;
    return {
      coverageKey: row.coverageKey,
      sourceId: row.sourceId,
      metric: row.metric,
      entityType: row.entityType ?? undefined,
      entityId: row.entityId ?? undefined,
      coverageStart: row.coverageStart ?? undefined,
      coverageEnd: row.coverageEnd ?? undefined,
      completeness: row.completeness as SourceCoverageResult["completeness"],
      coverageReason: row.coverageReason ?? undefined,
      lastAttemptedAt: row.lastAttemptedAt ?? undefined,
      lastSucceededAt: row.lastSucceededAt ?? undefined,
      latestError: row.latestError ?? undefined,
      expectedSyncIntervalMs: row.expectedSyncIntervalMs ?? undefined,
      updatedAt: row.updatedAt,
      freshness: freshnessFor(
        row.lastSucceededAt ?? undefined,
        row.expectedSyncIntervalMs ?? undefined,
        asOf,
      ),
    };
  }

  queryDailyGitActivity(query: DailyGitActivityQuery): DailyGitActivity[] {
    const timeZone = query.timeZone ?? DEFAULT_TIME_ZONE;
    const start = utcRangeForLocalDate(query.startLocalDate, timeZone).start;
    const end = utcRangeForLocalDate(query.endLocalDateExclusive, timeZone).start;
    if (Date.parse(end) <= Date.parse(start)) {
      throw new RangeError("endLocalDateExclusive must be after startLocalDate");
    }

    const commitPredicates = [
      eq(normalizedEvents.eventType, "git.commit.discovered"),
      gte(normalizedEvents.occurredAt, start),
      lt(normalizedEvents.occurredAt, end),
    ];
    const pushPredicates = [eq(normalizedEvents.eventType, "github.push.observed")];
    if (query.repositoryIds !== undefined) {
      if (query.repositoryIds.length === 0) return [];
      const repositoryPredicate = inArray(normalizedEvents.repositoryId, [...query.repositoryIds]);
      commitPredicates.push(repositoryPredicate);
      pushPredicates.push(repositoryPredicate);
    }

    const commitEvents = this.db
      .select()
      .from(normalizedEvents)
      .where(and(...commitPredicates))
      .all()
      .map(storedEventToNormalizedEvent);
    // Reconcile all stored push observations before the requested interval is applied. Endpoint
    // timestamps can straddle a local-day boundary, and Repository Activity is canonical.
    const pushEvents = this.db
      .select()
      .from(normalizedEvents)
      .where(and(...pushPredicates))
      .all()
      .map(storedEventToNormalizedEvent);

    const commits = new Map(
      aggregateEventsByLocalDay(deduplicateCommits(commitEvents), {
        timeZone,
        eventTypes: ["git.commit.discovered"],
      }).map(({ localDate, count }) => [localDate, count]),
    );
    const pushes = new Map(
      aggregateEventsByLocalDay(deduplicatePushes(pushEvents), {
        timeZone,
        eventTypes: ["github.push.observed"],
      }).map(({ localDate, count }) => [localDate, count]),
    );

    const result: DailyGitActivity[] = [];
    for (let localDate = query.startLocalDate; localDate < query.endLocalDateExclusive; localDate = nextLocalDate(localDate)) {
      result.push({ localDate, commits: commits.get(localDate) ?? 0, pushes: pushes.get(localDate) ?? 0 });
    }
    return result;
  }

  countEvents(): number {
    const row = this.sqlite.prepare("SELECT count(*) AS count FROM normalized_events").get() as {
      count: number;
    };
    return row.count;
  }
}

export function openStorage(options: OpenStorageOptions): Storage {
  return new Storage(options);
}

export function createSourceId(): string {
  return randomUUID();
}
