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

function commit(occurredAt: string) {
  const sha = "a".repeat(40);
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
    expect(boundsForPeriod("month", "America/Denver", now).startLocalDate).toBe("2026-08-01");
    expect(boundsForPeriod("year", "America/Denver", now).startLocalDate).toBe("2026-01-01");
    expect(boundsForPeriod("all", "America/Denver", now).startLocalDate).toBe("1970-01-01");
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
