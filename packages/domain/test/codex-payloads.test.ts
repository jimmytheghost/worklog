import { describe, expect, it } from "vitest";

import { parseNormalizedEvent } from "../src/index.js";

function envelope(eventType: string, payload: unknown): Record<string, unknown> {
  return {
    eventId: `event-${eventType}`,
    eventType,
    schemaVersion: 1,
    entityType: "codex_session",
    entityId: "session-local-1",
    taskId: "task-local-1",
    sessionId: "session-local-1",
    occurredAt: "2026-08-31T12:00:00.000Z",
    occurredAtSource: "source",
    observedAt: "2026-08-31T12:00:01.000Z",
    sourceSystem: "codex_local",
    sourceAccountId: "codex-profile-1",
    sourceRecordId: `record-${eventType}`,
    adapterName: "codex-local",
    adapterVersion: "1.0.0",
    sourceFormatVersion: "fixture-v1",
    idempotencyKey: `codex:${eventType}:session-local-1`,
    attribution: "codex",
    confidence: "confirmed",
    completeness: "complete",
    payload,
  };
}

describe("Codex metadata-only payloads", () => {
  it("represents task labels and hashed workspace identity", () => {
    const parsed = parseNormalizedEvent(
      envelope("codex.task.started", {
        sourceTaskId: "thread-source-1",
        label: "Build activity collector",
        workspaceIdentityHash: "A".repeat(64),
      }),
    );

    expect(parsed.eventType).toBe("codex.task.started");
    if (parsed.eventType !== "codex.task.started") throw new Error("unexpected event type");
    expect(parsed.payload).toEqual({
      sourceTaskId: "thread-source-1",
      label: "Build activity collector",
      workspaceIdentityHash: "a".repeat(64),
    });
  });

  it("represents model, reasoning effort, agent role, and parent session", () => {
    const parsed = parseNormalizedEvent(
      envelope("codex.session.started", {
        sourceSessionId: "child-source-1",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        agentRole: "subagent",
        parentSessionId: "parent-source-1",
      }),
    );

    expect(parsed.eventType).toBe("codex.session.started");
    if (parsed.eventType !== "codex.session.started") throw new Error("unexpected event type");
    expect(parsed.payload.agentRole).toBe("subagent");
    expect(parsed.payload.parentSessionId).toBe("parent-source-1");
  });

  it("represents parent-child spawning and terminal status/duration", () => {
    expect(
      parseNormalizedEvent(
        envelope("codex.subagent.spawned", {
          parentSessionId: "parent-source-1",
          childSessionId: "child-source-1",
        }),
      ).payload,
    ).toEqual({ parentSessionId: "parent-source-1", childSessionId: "child-source-1" });

    expect(
      parseNormalizedEvent(
        envelope("codex.session.completed", {
          outcome: "completed",
          durationMilliseconds: 42_000,
        }),
      ).payload,
    ).toEqual({ outcome: "completed", durationMilliseconds: 42_000 });
  });

  it("represents revisioned active and terminal session state", () => {
    expect(
      parseNormalizedEvent(
        envelope("codex.session.state_observed", {
          sourceSessionId: "session-source-1",
          status: "active",
        }),
      ).payload,
    ).toEqual({ sourceSessionId: "session-source-1", status: "active" });

    expect(
      parseNormalizedEvent(
        envelope("codex.session.state_observed", {
          sourceSessionId: "session-source-1",
          status: "completed",
          durationMilliseconds: 42_000,
        }),
      ).payload,
    ).toEqual({
      sourceSessionId: "session-source-1",
      status: "completed",
      durationMilliseconds: 42_000,
    });
  });

  it("accepts a complete cumulative per-session token snapshot", () => {
    const payload = {
      counterKind: "cumulative",
      sourceSessionId: "session-source-1",
      countersAvailable: true,
      inputTokens: 1_000,
      cachedTokens: 400,
      cacheWriteTokens: 80,
      outputTokens: 250,
      reasoningTokens: 125,
      totalTokens: 1_455,
      bucketStart: "2026-08-31T11:00:00.000Z",
      bucketEnd: "2026-08-31T12:00:00.000Z",
    };

    expect(parseNormalizedEvent(envelope("codex.usage.recorded", payload)).payload).toEqual(payload);
  });

  it("represents unavailable counters as a superseding cumulative observation", () => {
    const payload = {
      counterKind: "cumulative",
      sourceSessionId: "session-source-1",
      countersAvailable: false,
      bucketStart: "2026-08-31T11:00:00.000Z",
      bucketEnd: "2026-08-31T12:00:00.000Z",
    } as const;

    expect(parseNormalizedEvent(envelope("codex.usage.recorded", payload)).payload).toEqual(payload);
  });

  it("keeps cumulative records without countersAvailable backward-compatible", () => {
    const payload = {
      counterKind: "cumulative",
      sourceSessionId: "session-source-1",
      inputTokens: 10,
      cachedTokens: 1,
      cacheWriteTokens: 2,
      outputTokens: 3,
      reasoningTokens: 4,
      totalTokens: 19,
      bucketStart: "2026-08-31T11:00:00.000Z",
      bucketEnd: "2026-08-31T12:00:00.000Z",
    } as const;

    expect(parseNormalizedEvent(envelope("codex.usage.recorded", payload)).payload).toEqual(payload);
  });

  it("keeps the pre-existing sparse usage payload valid", () => {
    expect(
      parseNormalizedEvent(
        envelope("codex.usage.recorded", {
          inputTokens: 100,
          outputTokens: 20,
          bucketStart: "2026-08-31T11:00:00.000Z",
          bucketEnd: "2026-08-31T12:00:00.000Z",
        }),
      ).payload,
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      bucketStart: "2026-08-31T11:00:00.000Z",
      bucketEnd: "2026-08-31T12:00:00.000Z",
    });
  });

  it.each([
    ["codex.task.started", { sourceTaskId: "task", prompt: "forbidden" }],
    ["codex.session.started", { sourceSessionId: "session", command: "forbidden" }],
    [
      "codex.session.state_observed",
      { sourceSessionId: "session", status: "active", toolOutput: "forbidden" },
    ],
    [
      "codex.session.completed",
      { outcome: "completed", response: "forbidden" },
    ],
    [
      "codex.usage.recorded",
      {
        counterKind: "cumulative",
        sourceSessionId: "session",
        inputTokens: 1,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
        totalTokens: 2,
        bucketStart: "2026-08-31T11:00:00.000Z",
        bucketEnd: "2026-08-31T12:00:00.000Z",
        toolOutput: "forbidden",
      },
    ],
  ])("strictly rejects prohibited or unknown %s fields", (eventType, payload) => {
    expect(() => parseNormalizedEvent(envelope(eventType, payload))).toThrow();
  });
});
