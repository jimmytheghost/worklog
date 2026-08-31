import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TIME_ZONE,
  aggregateEventsByLocalDay,
  parseNormalizedEvent,
  utcRangeForLocalDate,
  type AnyNormalizedEvent,
  type Freshness,
} from "@agent-dashboard/domain";
import BetterSqlite3 from "better-sqlite3";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { normalizedEvents, projects, sourceCoverage, sources, syncCursors } from "./schema.js";
import type {
  DailyGitActivity,
  DailyGitActivityQuery,
  ProjectInput,
  ProjectSummary,
  SourceCoverageInput,
  SourceCoverageResult,
  SourceInput,
  SyncCursorInput,
} from "./types.js";

const defaultMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
export const MAX_RECENT_EVENTS_LIMIT = 500;

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

    const predicates = [
      inArray(normalizedEvents.eventType, ["git.commit.discovered", "github.push.observed"]),
      gte(normalizedEvents.occurredAt, start),
      lt(normalizedEvents.occurredAt, end),
    ];
    if (query.repositoryIds !== undefined) {
      if (query.repositoryIds.length === 0) return [];
      predicates.push(inArray(normalizedEvents.repositoryId, [...query.repositoryIds]));
    }

    const rows = this.db.select().from(normalizedEvents).where(and(...predicates)).all();
    const events = rows.map(storedEventToNormalizedEvent);

    const commits = new Map(
      aggregateEventsByLocalDay(events, {
        timeZone,
        eventTypes: ["git.commit.discovered"],
      }).map(({ localDate, count }) => [localDate, count]),
    );
    const pushes = new Map(
      aggregateEventsByLocalDay(events, {
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
