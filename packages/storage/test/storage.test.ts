import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitIdempotencyKey, githubPushIdempotencyKey, type AnyNormalizedEvent } from "@agent-dashboard/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStorage, type Storage } from "../src/index.js";

let directory: string;
let storage: Storage;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agent-dashboard-storage-"));
  storage = openStorage({ filename: join(directory, "test.sqlite") });
});

afterEach(() => {
  storage.close();
  rmSync(directory, { recursive: true, force: true });
});

function event(
  eventType: "git.commit.discovered" | "github.push.observed",
  occurredAt: string,
  suffix: string,
): AnyNormalizedEvent {
  const isCommit = eventType === "git.commit.discovered";
  const shaSuffix = suffix.replace(/[^0-9a-f]/gi, "") || "0";
  const sha = shaSuffix.padStart(40, "a").slice(-40);
  return {
    eventId: `event-${suffix}`,
    eventType,
    schemaVersion: 1,
    entityType: isCommit ? "commit" : "push",
    entityId: `${isCommit ? "commit" : "push"}-${suffix}`,
    repositoryId: "project-local-id",
    occurredAt,
    occurredAtSource: "source",
    observedAt: "2026-08-31T12:00:00.000Z",
    sourceSystem: isCommit ? "git_local" : "github",
    sourceAccountId: "source-1",
    sourceRecordId: `record-${suffix}`,
    adapterName: isCommit ? "git" : "github",
    adapterVersion: "1.0.0",
    idempotencyKey: isCommit
      ? commitIdempotencyKey("project-local-id", sha)
      : githubPushIdempotencyKey("source-1", suffix),
    attribution: "unknown",
    confidence: "unknown",
    completeness: "complete",
    payload: isCommit
      ? { sha, committerOccurredAt: occurredAt, parentShas: [] }
      : { ref: "refs/heads/main", commitShas: [sha], membershipComplete: true },
  } as AnyNormalizedEvent;
}

describe("Storage", () => {
  it("opens, migrates, and closes idempotently", () => {
    expect(storage.closed).toBe(false);
    storage.close();
    storage.close();
    expect(storage.closed).toBe(true);
  });

  it("upserts projects by immutable source identity across renames", () => {
    storage.upsertSource({
      id: "source-1",
      system: "github",
      immutableSourceId: "github-user-1",
      displayName: "JimmyTheGhost",
    });
    const original = storage.upsertProject({
      id: "project-local-id",
      sourceId: "source-1",
      immutableSourceId: "github-repo-42",
      name: "old-name",
      owner: "JimmyTheGhost",
    });
    const renamed = storage.upsertProject({
      id: "a-new-candidate-id-that-must-not-win",
      sourceId: "source-1",
      immutableSourceId: "github-repo-42",
      name: "agent-dashboard",
      owner: "JimmyTheGhost",
    });

    expect(renamed?.id).toBe(original?.id);
    expect(renamed?.name).toBe("agent-dashboard");
    expect(storage.listProjects()).toEqual([
      {
        id: "project-local-id",
        name: "agent-dashboard",
        owner: "JimmyTheGhost",
        defaultBranch: null,
        visibility: "unknown",
        updatedAt: renamed?.updatedAt,
      },
    ]);
  });

  it("validates a batch first and inserts events transactionally and idempotently", () => {
    const commit = event("git.commit.discovered", "2026-08-31T06:00:00.000Z", "1");
    expect(storage.insertEvents([commit, commit])).toEqual({ inserted: 1, ignored: 1 });
    expect(storage.insertEvents([commit])).toEqual({ inserted: 0, ignored: 1 });
    expect(storage.countEvents()).toBe(1);

    expect(() => storage.insertEvents([commit, { unsafe: "prompt content" }])).toThrow();
    expect(storage.countEvents()).toBe(1);
  });

  it("rejects non-UTC event instants before storage", () => {
    const commit = event("git.commit.discovered", "2026-08-31T06:00:00.000Z", "utc");
    expect(() =>
      storage.insertEvents([
        {
          ...commit,
          occurredAt: "2026-08-31T00:00:00-06:00",
          payload: {
            ...commit.payload,
            committerOccurredAt: "2026-08-31T00:00:00-06:00",
          },
        },
      ]),
    ).toThrow(/UTC/);
    expect(storage.countEvents()).toBe(0);
  });

  it("stores opaque sync cursors without mixing them into event payloads", () => {
    storage.upsertSource({ id: "source-1", system: "github", immutableSourceId: "account-1" });
    storage.setSyncCursor({ sourceId: "source-1", adapterName: "github", cursor: { page: 3 } });
    expect(storage.getSyncCursor("source-1", "github")).toEqual({ page: 3 });
    storage.setSyncCursor({ sourceId: "source-1", adapterName: "github", cursor: { page: 4 } });
    expect(storage.getSyncCursor("source-1", "github")).toEqual({ page: 4 });
  });

  it("lists recent events newest-first with a deterministic bounded limit", () => {
    storage.insertEvents([
      event("git.commit.discovered", "2026-08-30T10:00:00.000Z", "older"),
      event("git.commit.discovered", "2026-08-31T10:00:00.000Z", "middle"),
      event("github.push.observed", "2026-09-01T10:00:00.000Z", "newer"),
    ]);

    expect(storage.listRecentEvents(2).map(({ eventId }) => eventId)).toEqual([
      "event-newer",
      "event-middle",
    ]);
  });

  it("rejects unsafe recent-event limits", () => {
    for (const limit of [0, -1, 1.5, 501, Number.NaN]) {
      expect(() => storage.listRecentEvents(limit)).toThrow(/limit/);
    }
  });

  it("reports source freshness from the last successful sync", () => {
    storage.upsertSource({ id: "source-1", system: "github", immutableSourceId: "account-1" });
    storage.upsertCoverage({
      coverageKey: "source-1:pushes",
      sourceId: "source-1",
      metric: "pushes",
      completeness: "prospective",
      coverageStart: "2026-08-30T00:00:00.000Z",
      lastAttemptedAt: "2026-08-30T11:00:00.000Z",
      lastSucceededAt: "2026-08-30T10:00:00.000Z",
      latestError: "rate limited",
      expectedSyncIntervalMs: 60 * 60 * 1_000,
    });

    expect(storage.getCoverage("source-1:pushes", new Date("2026-08-30T10:30:00.000Z"))?.freshness).toBe(
      "fresh",
    );
    expect(storage.getCoverage("source-1:pushes", new Date("2026-08-30T12:00:00.001Z"))?.freshness).toBe(
      "stale",
    );
  });

  it("queries zero-filled daily commit and push metrics in America/Denver", () => {
    storage.insertEvents([
      event("git.commit.discovered", "2026-08-31T05:59:59.000Z", "1"),
      event("git.commit.discovered", "2026-08-31T06:00:00.000Z", "2"),
      event("github.push.observed", "2026-08-31T18:00:00.000Z", "push-1"),
    ]);

    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-30",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([
      { localDate: "2026-08-30", commits: 1, pushes: 0 },
      { localDate: "2026-08-31", commits: 1, pushes: 1 },
    ]);
  });

  it("counts equivalent push observations with different endpoint timestamps once", () => {
    const first = event("github.push.observed", "2026-08-31T18:00:00.000Z", "legacy-push");
    if (first.eventType !== "github.push.observed") throw new Error("expected push fixture");
    const transition = {
      beforeSha: "A".repeat(40),
      afterSha: "B".repeat(40),
    };
    const firstWithTransition = {
      ...first,
      payload: { ...first.payload, ...transition },
    } satisfies AnyNormalizedEvent;
    const second = {
      ...firstWithTransition,
      eventId: "event-repository-activity-push",
      entityId: "source-1:github-activity:9001",
      sourceRecordId: "activity:9001",
      idempotencyKey: githubPushIdempotencyKey("source-1", "activity:9001"),
      adapterName: "github-repository-activity",
      occurredAt: "2026-08-31T18:01:30.000Z",
      payload: { ...firstWithTransition.payload, beforeSha: transition.beforeSha.toLowerCase() },
    } satisfies AnyNormalizedEvent;

    storage.insertEvents([firstWithTransition, second]);

    expect(storage.countEvents()).toBe(2);
    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-31",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([{ localDate: "2026-08-31", commits: 0, pushes: 1 }]);
  });

  it("keeps missing-SHA push observations distinct when timestamps differ", () => {
    const first = event("github.push.observed", "2026-08-31T18:00:00.000Z", "missing-shas-1");
    const second = {
      ...first,
      eventId: "event-missing-shas-2",
      entityId: "push-missing-shas-2",
      sourceRecordId: "record-missing-shas-2",
      idempotencyKey: githubPushIdempotencyKey("source-1", "missing-shas-2"),
      occurredAt: "2026-08-31T18:01:30.000Z",
    } satisfies AnyNormalizedEvent;

    storage.insertEvents([first, second]);

    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-31",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([{ localDate: "2026-08-31", commits: 0, pushes: 2 }]);
  });

  it("preserves repeated identical transitions within the larger native endpoint", () => {
    const legacyFirst = event("github.push.observed", "2026-08-31T18:00:00.000Z", "repeat-legacy-1");
    if (legacyFirst.eventType !== "github.push.observed") throw new Error("expected push fixture");
    const payload = {
      ...legacyFirst.payload,
      beforeSha: "1".repeat(40),
      afterSha: "2".repeat(40),
    };
    const legacyFirstWithTransition = { ...legacyFirst, payload } satisfies AnyNormalizedEvent;
    const legacySecond = {
      ...legacyFirstWithTransition,
      eventId: "event-repeat-legacy-2",
      entityId: "source-1:github-event:repeat-legacy-2",
      sourceRecordId: "repeat-legacy-2",
      idempotencyKey: githubPushIdempotencyKey("source-1", "repeat-legacy-2"),
      occurredAt: "2026-08-31T20:00:00.000Z",
    } satisfies AnyNormalizedEvent;
    const activity = {
      ...legacyFirstWithTransition,
      eventId: "event-repeat-activity-1",
      entityId: "source-1:github-activity:repeat-activity-1",
      sourceRecordId: "activity:repeat-activity-1",
      idempotencyKey: githubPushIdempotencyKey("source-1", "activity:repeat-activity-1"),
      occurredAt: "2026-08-31T18:01:00.000Z",
    } satisfies AnyNormalizedEvent;

    storage.insertEvents([legacyFirstWithTransition, legacySecond, activity]);

    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-31",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([{ localDate: "2026-08-31", commits: 0, pushes: 2 }]);
  });

  it("collapses pre- and post-namespacing Activity aliases with the same stable entity ID", () => {
    const oldAlias = event("github.push.observed", "2026-08-31T18:00:00.000Z", "activity-alias-old");
    if (oldAlias.eventType !== "github.push.observed") throw new Error("expected push fixture");
    const oldAliasWithTransition = {
      ...oldAlias,
      entityId: "source-1:github-activity:alias-9001",
      sourceRecordId: "alias-9001",
      payload: {
        ...oldAlias.payload,
        beforeSha: "5".repeat(40),
        afterSha: "6".repeat(40),
      },
    } satisfies AnyNormalizedEvent;
    const namespacedAlias = {
      ...oldAliasWithTransition,
      eventId: "event-activity-alias-new",
      sourceRecordId: "activity:alias-9001",
      idempotencyKey: githubPushIdempotencyKey("source-1", "activity:alias-9001"),
      observedAt: "2026-08-31T19:00:00.000Z",
    } satisfies AnyNormalizedEvent;

    storage.insertEvents([oldAliasWithTransition, namespacedAlias]);

    expect(storage.countEvents()).toBe(2);
    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-31",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([{ localDate: "2026-08-31", commits: 0, pushes: 1 }]);
  });

  it("preserves Activity observations with distinct entity IDs for the same transition", () => {
    const first = event("github.push.observed", "2026-08-31T18:00:00.000Z", "activity-repeat-1");
    if (first.eventType !== "github.push.observed") throw new Error("expected push fixture");
    const firstActivity = {
      ...first,
      entityId: "source-1:github-activity:repeat-1",
      sourceRecordId: "activity:repeat-1",
      payload: {
        ...first.payload,
        beforeSha: "7".repeat(40),
        afterSha: "8".repeat(40),
      },
    } satisfies AnyNormalizedEvent;
    const secondActivity = {
      ...firstActivity,
      eventId: "event-activity-repeat-2",
      entityId: "source-1:github-activity:repeat-2",
      sourceRecordId: "activity:repeat-2",
      idempotencyKey: githubPushIdempotencyKey("source-1", "activity:repeat-2"),
      occurredAt: "2026-08-31T20:00:00.000Z",
    } satisfies AnyNormalizedEvent;

    storage.insertEvents([firstActivity, secondActivity]);

    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-31",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([{ localDate: "2026-08-31", commits: 0, pushes: 2 }]);
  });

  it("uses Repository Activity day assignment when endpoint timestamps straddle Denver midnight", () => {
    const legacy = event("github.push.observed", "2026-08-31T05:59:30.000Z", "midnight-legacy");
    if (legacy.eventType !== "github.push.observed") throw new Error("expected push fixture");
    const legacyWithTransition = {
      ...legacy,
      payload: {
        ...legacy.payload,
        beforeSha: "3".repeat(40),
        afterSha: "4".repeat(40),
      },
    } satisfies AnyNormalizedEvent;
    const activity = {
      ...legacyWithTransition,
      eventId: "event-midnight-activity",
      entityId: "source-1:github-activity:midnight-activity",
      sourceRecordId: "activity:midnight-activity",
      idempotencyKey: githubPushIdempotencyKey("source-1", "activity:midnight-activity"),
      occurredAt: "2026-08-31T06:00:30.000Z",
    } satisfies AnyNormalizedEvent;

    storage.insertEvents([legacyWithTransition, activity]);

    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-30",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([
      { localDate: "2026-08-30", commits: 0, pushes: 0 },
      { localDate: "2026-08-31", commits: 0, pushes: 1 },
    ]);
    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-30",
        endLocalDateExclusive: "2026-08-31",
      }),
    ).toEqual([{ localDate: "2026-08-30", commits: 0, pushes: 0 }]);
  });

  it("keeps same-time pushes distinct when their target SHAs differ", () => {
    const first = event("github.push.observed", "2026-08-31T18:00:00.000Z", "push-after-1");
    if (first.eventType !== "github.push.observed") throw new Error("expected push fixture");
    const firstAfter = "1".padStart(40, "a");
    const secondAfter = "2".padStart(40, "a");
    const firstWithTarget = {
      ...first,
      payload: { ...first.payload, beforeSha: "0".padStart(40, "a"), afterSha: firstAfter },
    } satisfies AnyNormalizedEvent;
    const secondWithTarget = {
      ...firstWithTarget,
      eventId: "event-push-after-2",
      entityId: "push-after-2",
      sourceRecordId: "record-push-after-2",
      idempotencyKey: githubPushIdempotencyKey("source-1", "push-after-2"),
      payload: { ...firstWithTarget.payload, afterSha: secondAfter },
    } satisfies AnyNormalizedEvent;

    storage.insertEvents([firstWithTarget, secondWithTarget]);

    expect(
      storage.queryDailyGitActivity({
        startLocalDate: "2026-08-31",
        endLocalDateExclusive: "2026-09-01",
      }),
    ).toEqual([{ localDate: "2026-08-31", commits: 0, pushes: 2 }]);
  });
});
