import { describe, expect, it } from "vitest";

import {
  aggregateEventsByLocalDay,
  commitIdempotencyKey,
  deduplicateEvents,
  localDateForInstant,
  metricResultSchema,
  openAiBucketIdempotencyKey,
  syntheticGithubPushIdempotencyKey,
  utcRangeForLocalDate,
  type AnyNormalizedEvent,
  type MetricResult,
} from "../src/index.js";

function commitEvent(overrides: Partial<AnyNormalizedEvent> = {}): AnyNormalizedEvent {
  return {
    eventId: "event-1",
    eventType: "git.commit.discovered",
    schemaVersion: 1,
    entityType: "commit",
    entityId: "commit-1",
    repositoryId: "repo-1",
    occurredAt: "2026-08-31T05:59:59.000Z",
    occurredAtSource: "source",
    observedAt: "2026-08-31T06:00:00.000Z",
    sourceSystem: "git_local",
    sourceAccountId: "local-1",
    sourceRecordId: "record-1",
    adapterName: "git",
    adapterVersion: "1.0.0",
    idempotencyKey: commitIdempotencyKey("repo-1", "a".repeat(40)),
    attribution: "unknown",
    confidence: "unknown",
    completeness: "complete",
    payload: {
      sha: "a".repeat(40),
      committerOccurredAt: "2026-08-31T05:59:59.000Z",
      parentShas: [],
    },
    ...overrides,
  } as AnyNormalizedEvent;
}

describe("idempotency", () => {
  it("normalizes commit SHA case and avoids delimiter collisions", () => {
    expect(commitIdempotencyKey("repo:one", "A".repeat(40))).toBe(
      commitIdempotencyKey("repo:one", "a".repeat(40)),
    );
    expect(commitIdempotencyKey("a:b", "c")).not.toBe(commitIdempotencyKey("a", "b:c"));
  });

  it("produces stable keys for unordered OpenAI dimensions", () => {
    const base = {
      sourceAccountId: "account",
      endpoint: "usage" as const,
      bucketStart: "2026-08-01T00:00:00Z",
      bucketEnd: "2026-08-02T00:00:00Z",
    };
    expect(openAiBucketIdempotencyKey({ ...base, dimensions: { model: "x", project: "y" } })).toBe(
      openAiBucketIdempotencyKey({ ...base, dimensions: { project: "y", model: "x" } }),
    );
  });

  it("makes synthetic push identity deterministic and field-sensitive", () => {
    const identity = {
      sourceAccountId: "account",
      repositoryId: "repo",
      actorId: "actor",
      ref: "refs/heads/main",
      beforeSha: "a".repeat(40),
      afterSha: "b".repeat(40),
      occurredAt: "2026-08-31T00:00:00Z",
    };
    expect(syntheticGithubPushIdempotencyKey(identity)).toBe(
      syntheticGithubPushIdempotencyKey({ ...identity }),
    );
    expect(syntheticGithubPushIdempotencyKey(identity)).not.toBe(
      syntheticGithubPushIdempotencyKey({ ...identity, ref: "refs/heads/release" }),
    );
  });

  it("keeps the first event for a replayed idempotency key", () => {
    const first = commitEvent();
    const replay = commitEvent({ eventId: "event-replayed", observedAt: "2026-09-01T00:00:00Z" });
    expect(deduplicateEvents([first, replay])).toEqual([first]);
    expect(aggregateEventsByLocalDay([first, replay])).toEqual([
      { localDate: "2026-08-30", count: 1 },
    ]);
  });
});

describe("metric null and zero semantics", () => {
  const metric = {
    metric: "commits",
    unit: "count",
    interval: {
      start: "2026-08-01T06:00:00Z",
      end: "2026-09-01T06:00:00Z",
      timezone: "America/Denver",
    },
    dimensions: {},
    sourceSystems: ["git_local"],
    freshness: "fresh",
  } satisfies Omit<MetricResult, "value" | "completeness">;

  it("preserves a covered zero as a real measurement", () => {
    const parsed = metricResultSchema.parse({ ...metric, value: 0, completeness: "complete" });
    expect(parsed.value).toBe(0);
  });

  it("preserves unavailable as null and rejects a fabricated zero", () => {
    expect(metricResultSchema.parse({ ...metric, value: null, completeness: "unavailable" }).value).toBeNull();
    expect(() => metricResultSchema.parse({ ...metric, value: 0, completeness: "unavailable" })).toThrow();
  });

  it("rejects null for a covered metric", () => {
    expect(() => metricResultSchema.parse({ ...metric, value: null, completeness: "complete" })).toThrow();
  });
});

describe("America/Denver calendar boundaries", () => {
  it("assigns instants on opposite sides of local midnight to different days", () => {
    expect(localDateForInstant("2026-08-31T05:59:59Z")).toBe("2026-08-30");
    expect(localDateForInstant("2026-08-31T06:00:00Z")).toBe("2026-08-31");
  });

  it("creates a 23-hour half-open day for the spring DST transition", () => {
    expect(utcRangeForLocalDate("2026-03-08")).toEqual({
      localDate: "2026-03-08",
      timeZone: "America/Denver",
      start: "2026-03-08T07:00:00.000Z",
      end: "2026-03-09T06:00:00.000Z",
      durationMilliseconds: 23 * 60 * 60 * 1_000,
    });
  });

  it("creates a 25-hour half-open day for the fall DST transition", () => {
    expect(utcRangeForLocalDate("2026-11-01")).toEqual({
      localDate: "2026-11-01",
      timeZone: "America/Denver",
      start: "2026-11-01T06:00:00.000Z",
      end: "2026-11-02T07:00:00.000Z",
      durationMilliseconds: 25 * 60 * 60 * 1_000,
    });
  });
});
