import { commitIdempotencyKey, parseNormalizedEvent } from "@agent-dashboard/domain";
import { openStorage } from "@agent-dashboard/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildMonthlyHistory } from "../src/history.js";

const stores: ReturnType<typeof openStorage>[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function store() {
  const storage = openStorage({ filename: ":memory:" });
  stores.push(storage);
  storage.upsertSource({ id: "github:primary", system: "github", immutableSourceId: "42" });
  for (const [id, name] of [["github:1", "alpha"], ["github:2", "beta"], ["github:3", "quiet"]] as const) {
    storage.upsertProject({ id, sourceId: "github:primary", immutableSourceId: id, name, owner: "jimmy", defaultBranch: "main" });
  }
  return storage;
}

function commit(repositoryId: string, suffix: string, occurredAt: string, subject: string) {
  const sha = suffix.padStart(40, "a");
  const key = commitIdempotencyKey(repositoryId, sha);
  return parseNormalizedEvent({
    eventId: key,
    eventType: "git.commit.discovered",
    schemaVersion: 1,
    entityType: "commit",
    entityId: `${repositoryId}:commit:${sha}`,
    repositoryId,
    occurredAt,
    occurredAtSource: "source",
    observedAt: "2026-09-01T00:00:00.000Z",
    sourceSystem: "github",
    sourceAccountId: "42",
    sourceRecordId: sha,
    adapterName: "history-test",
    adapterVersion: "1.0.0",
    idempotencyKey: key,
    attribution: "unknown",
    confidence: "unknown",
    completeness: "partial",
    payload: { sha, subject, url: `https://github.com/jimmy/repo/commit/${sha}`, committerOccurredAt: occurredAt, parentShas: [] },
  });
}

describe("monthly work history", () => {
  it("returns every project active in the month with privacy-safe commit subjects", () => {
    const storage = store();
    storage.insertEvents([
      commit("github:1", "1", "2026-08-02T12:00:00.000Z", "Build the compact dashboard"),
      commit("github:2", "2", "2026-08-20T12:00:00.000Z", "Remember every monthly project"),
      commit("github:3", "3", "2026-07-20T12:00:00.000Z", "Outside the selected month"),
    ]);

    const history = buildMonthlyHistory(storage, { month: "2026-08", timeZone: "UTC" });

    expect(history.summary).toMatchObject({ projects: 2, commits: 2, pushes: 0 });
    expect(history.projects.map((project) => project.name)).toEqual(["beta", "alpha"]);
    expect(history.projects.flatMap((project) => project.activity).map((event) => event.subject)).toEqual([
      "Remember every monthly project",
      "Build the compact dashboard",
    ]);
  });

  it("rejects invalid month input", () => {
    expect(() => buildMonthlyHistory(store(), { month: "August", timeZone: "UTC" })).toThrow(/YYYY-MM/);
  });
});

