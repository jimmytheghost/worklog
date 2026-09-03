import { commitIdempotencyKey, parseNormalizedEvent } from "@agent-dashboard/domain";
import { openStorage } from "@agent-dashboard/storage";
import { afterEach, describe, expect, it } from "vitest";

import { boundsForPeriod, buildPeriodSummary } from "../src/period-summary.js";

const stores: ReturnType<typeof openStorage>[] = [];
afterEach(() => stores.splice(0).forEach((storage) => storage.close()));

function storage() {
  const value = openStorage({ filename: ":memory:" });
  stores.push(value);
  value.upsertSource({ id: "github:primary", system: "github", immutableSourceId: "42" });
  value.upsertProject({ id: "github:1", sourceId: "github:primary", immutableSourceId: "1", name: "worklog" });
  return value;
}

function commit(occurredAt: string, sha = "a".repeat(40)) {
  const key = commitIdempotencyKey("github:1", sha);
  return parseNormalizedEvent({
    eventId: key, eventType: "git.commit.discovered", schemaVersion: 1,
    entityType: "commit", entityId: `github:1:commit:${sha}`, repositoryId: "github:1",
    occurredAt, occurredAtSource: "source", observedAt: "2026-09-01T04:00:00.000Z",
    sourceSystem: "github", sourceAccountId: "42", sourceRecordId: sha,
    adapterName: "period-test", adapterVersion: "1.0.0", idempotencyKey: key,
    attribution: "unknown", confidence: "unknown", completeness: "partial",
    payload: { sha, subject: "Add range picker", committerOccurredAt: occurredAt, parentShas: [] },
  });
}

describe("period summary", () => {
  it("uses local calendar boundaries for day, week, month, and year", () => {
    const now = new Date("2026-09-01T04:00:00.000Z"); // Aug 31 in Denver
    expect(boundsForPeriod("day", "America/Denver", now).startLocalDate).toBe("2026-08-31");
    expect(boundsForPeriod("week", "America/Denver", now).startLocalDate).toBe("2026-08-25");
    expect(boundsForPeriod("month", "America/Denver", now).startLocalDate).toBe("2026-08-02");
    expect(boundsForPeriod("year", "America/Denver", now).startLocalDate).toBe("2026-01-01");
    expect(boundsForPeriod("all", "America/Denver", now).startLocalDate).toBe("1970-01-01");
  });

  it.each([
    ["2026-09-03T02:37:00.000Z", "2026-08-04", "2026-09-03", "2026-08-04T06:00:00.000Z", "2026-09-03T06:00:00.000Z"],
    ["2026-01-02T19:00:00.000Z", "2025-12-04", "2026-01-03", "2025-12-04T07:00:00.000Z", "2026-01-03T07:00:00.000Z"],
    ["2026-03-20T18:00:00.000Z", "2026-02-19", "2026-03-21", "2026-02-19T07:00:00.000Z", "2026-03-21T06:00:00.000Z"],
    ["2028-03-01T19:00:00.000Z", "2028-02-01", "2028-03-02", "2028-02-01T07:00:00.000Z", "2028-03-02T07:00:00.000Z"],
  ])("includes today and the previous 29 local days for Month at %s", (instant, startLocalDate, endLocalDateExclusive, start, end) => {
    expect(boundsForPeriod("month", "America/Denver", new Date(instant))).toEqual({
      startLocalDate, endLocalDateExclusive, start, end,
    });
  });

  it("includes the first and last days of the rolling month and excludes adjacent days", () => {
    const value = storage();
    value.insertEvents([
      commit("2026-08-04T05:59:59.999Z", "a".repeat(40)), // Aug 3: outside
      commit("2026-08-04T06:00:00.000Z", "b".repeat(40)), // Aug 4: first day
      commit("2026-09-03T05:59:59.999Z", "c".repeat(40)), // Sep 2: today
      commit("2026-09-03T06:00:00.000Z", "d".repeat(40)), // Sep 3: outside
    ]);
    const month = buildPeriodSummary(value, {
      period: "month", timeZone: "America/Denver", now: new Date("2026-09-03T05:59:59.999Z"),
    });
    expect(month.metrics).toMatchObject({ commits: 2, pushes: 0, activeDays: 2, projects: 1 });
    expect(month.recentActivity.map((event) => event.occurredAt)).toEqual([
      "2026-09-03T05:59:59.999Z", "2026-08-04T06:00:00.000Z",
    ]);
  });

  it("returns only activity inside the selected period", () => {
    const value = storage();
    value.insertEvents([commit("2026-08-31T18:00:00.000Z")]);
    const day = buildPeriodSummary(value, {
      period: "day", timeZone: "America/Denver", now: new Date("2026-09-01T04:00:00.000Z"),
    });
    expect(day.metrics).toMatchObject({ commits: 1, pushes: 0, activeDays: 1, projects: 1 });
    expect(day.recentActivity[0]?.summary).toBe("Add range picker");
  });
});
