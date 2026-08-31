import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStorage, type Storage } from "../src/index.js";

let directory: string;
let storage: Storage;
let eventSequence = 0;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agent-dashboard-codex-read-"));
  storage = openStorage({ filename: join(directory, "test.sqlite") });
  eventSequence = 0;
});

afterEach(() => {
  storage.close();
  rmSync(directory, { recursive: true, force: true });
});

function codexEvent(
  eventType: string,
  occurredAt: string,
  payload: Record<string, unknown>,
  links: { taskId?: string; sessionId?: string; repositoryId?: string } = {},
): Record<string, unknown> {
  eventSequence += 1;
  return {
    eventId: `codex-event-${String(eventSequence).padStart(3, "0")}`,
    eventType,
    schemaVersion: 1,
    entityType: eventType.includes("task") ? "codex_task" : "codex_session",
    entityId: links.sessionId ?? links.taskId ?? `entity-${eventSequence}`,
    ...links,
    occurredAt,
    occurredAtSource: "source",
    observedAt: "2026-08-31T18:00:00.000Z",
    sourceSystem: "codex_local",
    sourceAccountId: "profile-1",
    sourceRecordId: `source-record-${eventSequence}`,
    adapterName: "codex-local",
    adapterVersion: "1.0.0",
    idempotencyKey: `codex:test:${eventSequence}`,
    attribution: "codex",
    confidence: "confirmed",
    completeness: "complete",
    payload,
  };
}

function insertTopology(): void {
  storage.insertEvents([
    codexEvent(
      "codex.task.started",
      "2026-08-31T10:00:00.000Z",
      {
        sourceTaskId: "source-task-1",
        label: "Private dashboard work",
        workspaceIdentityHash: "a".repeat(64),
      },
      { taskId: "task-1", repositoryId: "repo-1" },
    ),
    // The child starts before the parent is observed; topology still orders parent first.
    codexEvent(
      "codex.session.started",
      "2026-08-31T10:00:01.000Z",
      {
        sourceSessionId: "source-child",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        agentRole: "subagent",
        parentSessionId: "source-parent",
      },
      { taskId: "task-1", sessionId: "session-child" },
    ),
    codexEvent(
      "codex.session.started",
      "2026-08-31T10:00:02.000Z",
      {
        sourceSessionId: "source-parent",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        agentRole: "primary",
      },
      { taskId: "task-1", sessionId: "session-parent", repositoryId: "repo-1" },
    ),
    codexEvent(
      "codex.subagent.spawned",
      "2026-08-31T10:00:03.000Z",
      { parentSessionId: "source-parent", childSessionId: "source-child" },
      { taskId: "task-1", sessionId: "session-child" },
    ),
  ]);
}

function cumulativeUsage(
  sourceSessionId: string,
  sessionId: string,
  bucketEnd: string,
  totalTokens: number,
): Record<string, unknown> {
  return codexEvent(
    "codex.usage.recorded",
    bucketEnd,
    {
      counterKind: "cumulative",
      sourceSessionId,
      inputTokens: totalTokens - 5,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
      totalTokens,
      bucketStart: "2026-08-31T10:00:00.000Z",
      bucketEnd,
    },
    { taskId: "task-1", sessionId },
  );
}

describe("Codex read models", () => {
  it("reconstructs privacy-safe parent/child topology even when the child starts first", () => {
    insertTopology();

    const sessions = storage.listRecentCodexSessions(10);
    expect(sessions.map(({ id }) => id)).toEqual(["session-parent", "session-child"]);
    expect(sessions[1]).toMatchObject({
      id: "session-child",
      taskId: "task-1",
      parentSessionId: "session-parent",
      repositoryId: "repo-1",
      label: "Private dashboard work",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      role: "subagent",
      status: "active",
      completedAt: null,
      durationMilliseconds: null,
      totalObservedTokens: null,
    });

    const serialized = JSON.stringify(sessions);
    for (const prohibitedKey of [
      "payload",
      "prompt",
      "response",
      "command",
      "toolOutput",
      "workspaceIdentityHash",
      "sourceSessionId",
    ]) {
      expect(serialized).not.toContain(`\"${prohibitedKey}\"`);
    }
  });

  it("ignores a stale completion and leaves missing terminal duration unknown", () => {
    storage.insertEvents([
      codexEvent(
        "codex.session.started",
        "2026-08-31T12:00:00.000Z",
        { sourceSessionId: "source-session", agentRole: "primary" },
        { sessionId: "session-1" },
      ),
      codexEvent(
        "codex.session.completed",
        "2026-08-31T11:59:59.000Z",
        { outcome: "completed", durationMilliseconds: 50 },
        { sessionId: "session-1" },
      ),
    ]);

    expect(storage.listRecentCodexSessions(1)[0]).toMatchObject({
      status: "active",
      completedAt: null,
      durationMilliseconds: null,
      totalObservedTokens: null,
    });
  });

  it("lets a newer active state observation supersede an old completion", () => {
    storage.insertEvents([
      codexEvent(
        "codex.session.started",
        "2026-08-31T10:00:00.000Z",
        { sourceSessionId: "source-session", agentRole: "primary" },
        { sessionId: "session-1" },
      ),
      codexEvent(
        "codex.session.completed",
        "2026-08-31T11:00:00.000Z",
        { outcome: "completed", durationMilliseconds: 3_600_000 },
        { sessionId: "session-1" },
      ),
      codexEvent(
        "codex.session.state_observed",
        "2026-08-31T12:00:00.000Z",
        { sourceSessionId: "source-session", status: "active" },
        { sessionId: "session-1" },
      ),
    ]);

    expect(storage.listRecentCodexSessions(1)[0]).toMatchObject({
      status: "active",
      completedAt: null,
      durationMilliseconds: null,
    });
  });

  it("uses only the latest cumulative snapshot per session before totaling a task", () => {
    insertTopology();
    storage.insertEvents([
      cumulativeUsage("source-parent", "session-parent", "2026-08-31T11:00:00.000Z", 100),
      cumulativeUsage("source-parent", "session-parent", "2026-08-31T12:00:00.000Z", 150),
      cumulativeUsage("source-child", "session-child", "2026-08-31T11:30:00.000Z", 40),
      codexEvent(
        "codex.session.completed",
        "2026-08-31T12:30:00.000Z",
        { outcome: "completed", durationMilliseconds: 9_000_000 },
        { taskId: "task-1", sessionId: "session-parent" },
      ),
    ]);

    const byId = new Map(storage.listRecentCodexSessions(10).map((session) => [session.id, session]));
    expect(byId.get("session-parent")?.totalObservedTokens).toBe(150);
    expect(byId.get("session-child")?.totalObservedTokens).toBe(40);
    expect(storage.listRecentCodexTasks(10)[0]).toMatchObject({
      id: "task-1",
      primarySessionId: "session-parent",
      status: "completed",
      durationMilliseconds: 9_000_000,
      totalObservedTokens: 190,
      sessionIds: ["session-parent", "session-child"],
    });
  });

  it("does not turn sparse legacy usage or a missing session total into zero", () => {
    insertTopology();
    storage.insertEvents([
      codexEvent(
        "codex.usage.recorded",
        "2026-08-31T11:00:00.000Z",
        { inputTokens: 10, outputTokens: 5 },
        { taskId: "task-1", sessionId: "session-parent" },
      ),
      cumulativeUsage("source-child", "session-child", "2026-08-31T11:30:00.000Z", 40),
    ]);

    const sessions = storage.listRecentCodexSessions(10);
    expect(sessions.find(({ id }) => id === "session-parent")?.totalObservedTokens).toBeNull();
    expect(storage.listRecentCodexTasks(10)[0]?.totalObservedTokens).toBeNull();
  });

  it("lets a newer counters-unavailable observation supersede a known snapshot", () => {
    storage.insertEvents([
      codexEvent(
        "codex.session.started",
        "2026-08-31T10:00:00.000Z",
        { sourceSessionId: "source-session", agentRole: "primary" },
        { sessionId: "session-1" },
      ),
      cumulativeUsage("source-session", "session-1", "2026-08-31T11:00:00.000Z", 100),
      codexEvent(
        "codex.usage.recorded",
        "2026-08-31T12:00:00.000Z",
        {
          counterKind: "cumulative",
          sourceSessionId: "source-session",
          countersAvailable: false,
          bucketStart: "2026-08-31T10:00:00.000Z",
          bucketEnd: "2026-08-31T12:00:00.000Z",
        },
        { sessionId: "session-1" },
      ),
    ]);

    expect(storage.listRecentCodexSessions(1)[0]?.totalObservedTokens).toBeNull();
    expect(
      storage.queryCodexObservedTokens({
        start: "2026-08-31T00:00:00.000Z",
        end: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual({
      knownSubtotal: 0,
      knowledge: "unknown",
      sessionsObserved: 1,
      sessionsKnown: 0,
      sessionsUnknown: 1,
    });
  });

  it("queries range-matched sessions independently of the 500-row presentation limit", () => {
    const events: Record<string, unknown>[] = [];
    for (let index = 0; index < 501; index += 1) {
      const sourceSessionId = `source-${index}`;
      const sessionId = `session-${index}`;
      events.push(
        codexEvent(
          "codex.session.started",
          "2026-08-31T10:00:00.000Z",
          { sourceSessionId, agentRole: "primary" },
          { sessionId },
        ),
        cumulativeUsage(sourceSessionId, sessionId, "2026-08-31T11:00:00.000Z", 10),
      );
    }
    // This older session has an in-range usage observation but did not start in the interval.
    events.push(
      codexEvent(
        "codex.session.started",
        "2026-08-29T10:00:00.000Z",
        { sourceSessionId: "source-old", agentRole: "primary" },
        { sessionId: "session-old" },
      ),
      cumulativeUsage("source-old", "session-old", "2026-08-31T11:00:00.000Z", 999),
    );
    storage.insertEvents(events);

    expect(
      storage.queryCodexObservedTokens({
        start: "2026-08-31T00:00:00.000Z",
        end: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual({
      knownSubtotal: 5_010,
      knowledge: "complete",
      sessionsObserved: 501,
      sessionsKnown: 501,
      sessionsUnknown: 0,
    });
  });

  it("returns a known subtotal with partial knowledge instead of inventing missing counters", () => {
    storage.insertEvents([
      codexEvent(
        "codex.session.started",
        "2026-08-31T10:00:00.000Z",
        { sourceSessionId: "source-known", agentRole: "primary" },
        { sessionId: "session-known" },
      ),
      codexEvent(
        "codex.session.started",
        "2026-08-31T10:05:00.000Z",
        { sourceSessionId: "source-unknown", agentRole: "primary" },
        { sessionId: "session-unknown" },
      ),
      cumulativeUsage("source-known", "session-known", "2026-08-31T11:00:00.000Z", 75),
    ]);

    expect(
      storage.queryCodexObservedTokens({
        start: "2026-08-31T00:00:00.000Z",
        end: "2026-09-01T00:00:00.000Z",
      }),
    ).toEqual({
      knownSubtotal: 75,
      knowledge: "partial",
      sessionsObserved: 2,
      sessionsKnown: 1,
      sessionsUnknown: 1,
    });
  });

  it("validates the token query as a non-empty half-open UTC interval", () => {
    expect(() =>
      storage.queryCodexObservedTokens({
        start: "2026-08-31T00:00:00-06:00",
        end: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow(/UTC/);
    expect(() =>
      storage.queryCodexObservedTokens({
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow(/after start/);
  });

  it("enforces bounded task and session read limits", () => {
    for (const limit of [0, -1, 1.5, 501, Number.NaN]) {
      expect(() => storage.listRecentCodexSessions(limit)).toThrow(/limit/);
      expect(() => storage.listRecentCodexTasks(limit)).toThrow(/limit/);
    }
  });
});
