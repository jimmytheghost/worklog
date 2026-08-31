import {
  CodexCollectorError,
  type CodexCollectionResult,
} from "@agent-dashboard/collector-codex";
import { parseNormalizedEvent, type AnyNormalizedEvent } from "@agent-dashboard/domain";
import { openStorage, type Storage } from "@agent-dashboard/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { ServiceEventHub } from "../src/events.js";
import { CODEX_COVERAGE_KEY } from "../src/codex-sync.js";

const observedAt = "2026-08-31T12:00:00.000Z";
const now = () => new Date(observedAt);
const apps: ReturnType<typeof buildApp>[] = [];
const stores: Storage[] = [];
let sequence = 0;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const storage of stores.splice(0)) storage.close();
  sequence = 0;
});

function storage(): Storage {
  const created = openStorage({ filename: ":memory:" });
  stores.push(created);
  return created;
}

function event(
  eventType: string,
  occurredAt: string,
  payload: Record<string, unknown>,
  links: { taskId?: string; sessionId?: string } = {},
): AnyNormalizedEvent {
  sequence += 1;
  return parseNormalizedEvent({
    eventId: `codex-event-${sequence}`,
    eventType,
    schemaVersion: 1,
    entityType: eventType.includes("task") ? "codex_task" : "codex_session",
    entityId: links.sessionId ?? links.taskId ?? `entity-${sequence}`,
    ...links,
    occurredAt,
    occurredAtSource: "source",
    observedAt,
    sourceSystem: "codex_local",
    sourceAccountId: "codex-local:test",
    sourceRecordId: `record-${sequence}`,
    adapterName: "codex-local-experimental",
    adapterVersion: "0.0.0",
    sourceFormatVersion: "codex-local-experimental-v1.test",
    idempotencyKey: `codex:test:${sequence}`,
    attribution: "codex",
    confidence: "confirmed",
    completeness: "partial",
    payload,
  });
}

function usage(sourceSessionId: string, sessionId: string, at: string, totalTokens: number) {
  return event(
    "codex.usage.recorded",
    at,
    {
      counterKind: "cumulative",
      sourceSessionId,
      inputTokens: Math.max(0, totalTokens - 5),
      cachedTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: Math.min(5, totalTokens),
      reasoningTokens: 0,
      totalTokens,
      bucketStart: "2026-08-31T10:00:00.000Z",
      bucketEnd: at,
    },
    { taskId: "task-1", sessionId },
  );
}

function bulkCollection(inRangeSessions: number): CodexCollectionResult {
  const base = collection();
  const sessions: CodexCollectionResult["sessions"] = [];
  const events: AnyNormalizedEvent[] = [];
  for (let index = 0; index < inRangeSessions; index += 1) {
    const sourceSessionId = `source-bulk-${index}`;
    const sessionId = `session-bulk-${index}`;
    const startedAt = `2026-08-${String(1 + (index % 28)).padStart(2, "0")}T10:00:00.000Z`;
    sessions.push({
      sourceSessionId,
      startedAt,
      updatedAt: observedAt,
      status: "active",
      reasoningEffort: "medium",
      agentRole: "primary",
      workspaceIdentityHash: "c".repeat(64),
    });
    events.push(event(
      "codex.session.started",
      startedAt,
      { sourceSessionId, reasoningEffort: "medium", agentRole: "primary" },
      { sessionId },
    ));
    events.push(usage(sourceSessionId, sessionId, startedAt, 1));
  }

  const oldSourceSessionId = "source-out-of-range";
  const oldSessionId = "session-out-of-range";
  const oldAt = "2025-08-30T10:00:00.000Z";
  sessions.push({
    sourceSessionId: oldSourceSessionId,
    startedAt: oldAt,
    updatedAt: oldAt,
    status: "completed",
    reasoningEffort: "medium",
    agentRole: "primary",
    workspaceIdentityHash: "d".repeat(64),
  });
  events.push(event(
    "codex.session.started",
    oldAt,
    { sourceSessionId: oldSourceSessionId, reasoningEffort: "medium", agentRole: "primary" },
    { sessionId: oldSessionId },
  ));
  events.push(usage(oldSourceSessionId, oldSessionId, oldAt, 999));

  return {
    ...base,
    sessions,
    edges: [],
    events,
    coverage: {
      ...base.coverage,
      threadsObserved: sessions.length,
      usageSnapshotsObserved: sessions.length,
    },
  };
}

function collection(): CodexCollectionResult {
  const events = [
    event(
      "codex.task.started",
      "2026-08-31T10:00:00.000Z",
      { sourceTaskId: "source-task", workspaceIdentityHash: "a".repeat(64) },
      { taskId: "task-1" },
    ),
    event(
      "codex.session.started",
      "2026-08-31T10:00:01.000Z",
      { sourceSessionId: "source-child", model: "gpt-5.6-sol", reasoningEffort: "high", agentRole: "subagent", parentSessionId: "source-parent" },
      { taskId: "task-1", sessionId: "session-child" },
    ),
    event(
      "codex.session.started",
      "2026-08-31T10:00:02.000Z",
      { sourceSessionId: "source-parent", model: "gpt-5.6-sol", reasoningEffort: "high", agentRole: "primary" },
      { taskId: "task-1", sessionId: "session-parent" },
    ),
    event(
      "codex.subagent.spawned",
      "2026-08-31T10:00:03.000Z",
      { parentSessionId: "source-parent", childSessionId: "source-child" },
      { taskId: "task-1", sessionId: "session-child" },
    ),
    usage("source-parent", "session-parent", "2026-08-31T10:30:00.000Z", 100),
    usage("source-parent", "session-parent", "2026-08-31T11:00:00.000Z", 150),
    usage("source-child", "session-child", "2026-08-31T10:45:00.000Z", 40),
  ];
  return {
    sourceInstanceId: "codex-local:test",
    sourceFormatVersion: "codex-local-experimental-v1.test",
    schemaFingerprint: "b".repeat(64),
    sessions: [
      { sourceSessionId: "source-child", startedAt: "2026-08-31T10:00:01.000Z", updatedAt: observedAt, status: "active", model: "gpt-5.6-sol", reasoningEffort: "high", agentRole: "subagent", parentSessionId: "source-parent", workspaceIdentityHash: "a".repeat(64) },
      { sourceSessionId: "source-parent", startedAt: "2026-08-31T10:00:02.000Z", updatedAt: observedAt, status: "active", model: "gpt-5.6-sol", reasoningEffort: "high", agentRole: "primary", workspaceIdentityHash: "a".repeat(64) },
    ],
    edges: [{ parentSessionId: "source-parent", childSessionId: "source-child", reportedStatus: "open", resolvedStatus: "open" }],
    events,
    coverage: {
      source: "codex_local_experimental",
      supported: false,
      completeness: "partial",
      observedAt,
      schemaFingerprint: "b".repeat(64),
      sourceFormatVersion: "codex-local-experimental-v1.test",
      threadsObserved: 2,
      rolloutFilesRead: 2,
      usageSnapshotsObserved: 3,
      sessionsMissingCounters: 0,
      malformedMetadataLines: 0,
      reason: "PRIVATE /Users/person/.codex/raw/path",
    },
    warnings: [],
  };
}

class FixtureCollector {
  calls = 0;
  constructor(private readonly result: CodexCollectionResult) {}
  async collect() {
    this.calls += 1;
    return this.result;
  }
}

function integratedApp(store: Storage, collector: Pick<FixtureCollector, "collect">) {
  const app = buildApp({ storage: store, codexCollector: collector, fixtureMode: false, now, timeZone: "America/Denver" });
  apps.push(app);
  return app;
}

describe("Codex service integration", () => {
  it("does not block readiness while startup synchronization is pending and publishes its terminal state", async () => {
    const store = storage();
    const eventHub = new ServiceEventHub();
    const states: Array<Record<string, unknown>> = [];
    eventHub.subscribe(({ event, data }) => {
      if (event === "codex-sync") states.push(data);
    });
    let resolveCollection: ((value: CodexCollectionResult) => void) | undefined;
    const pendingCollection = new Promise<CodexCollectionResult>((resolve) => {
      resolveCollection = resolve;
    });
    const app = buildApp({
      storage: store,
      codexCollector: { collect: () => pendingCollection },
      codexSyncOnStart: true,
      fixtureMode: false,
      eventHub,
      now,
    });
    apps.push(app);

    await app.ready();

    expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
      codexSync: "running",
    });
    expect(states.map(({ status }) => status)).toEqual(["running"]);

    resolveCollection?.(collection());
    await expect.poll(() => states.at(-1)?.status).toBe("succeeded");

    expect(states.map(({ status }) => status)).toEqual(["running", "succeeded"]);
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
      codexSync: "succeeded",
    });
  });

  it("persists a first sync and remains idempotent", async () => {
    const store = storage();
    const collector = new FixtureCollector(collection());
    const app = integratedApp(store, collector);

    const first = await app.inject({ method: "POST", url: "/api/sync/codex" });
    const repeated = await app.inject({ method: "POST", url: "/api/sync/codex" });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "succeeded", insertedEvents: 7, ignoredEvents: 0, sessions: 2 });
    expect(repeated.json()).toMatchObject({ insertedEvents: 0, ignoredEvents: 7 });
    expect(store.countEvents()).toBe(7);
    expect(store.getCoverage(CODEX_COVERAGE_KEY, now())).toMatchObject({ completeness: "partial", lastSucceededAt: observedAt });
    expect(collector.calls).toBe(2);
  });

  it("sanitizes unsupported schema failures", async () => {
    const store = storage();
    let calls = 0;
    const app = integratedApp(store, {
      collect: async () => {
        calls += 1;
        if (calls === 1) return collection();
        throw new CodexCollectorError("unsupported_schema", "missing rollout_path at /Users/private/SECRET");
      },
    });

    await app.inject({ method: "POST", url: "/api/sync/codex" });
    const response = await app.inject({ method: "POST", url: "/api/sync/codex" });
    const coverage = store.getCoverage(CODEX_COVERAGE_KEY, now());

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(expect.objectContaining({
      status: "failed",
      error: { code: "unsupported_schema", message: "Local Codex metadata uses an unsupported schema" },
    }));
    expect(response.body).not.toContain("rollout_path");
    expect(response.body).not.toContain("/Users/private");
    expect(response.body).not.toContain("SECRET");
    expect(coverage?.latestError).toBe("Local Codex metadata uses an unsupported schema");
    expect(JSON.stringify(coverage)).not.toContain("/Users/private");
  });

  it("serves latest cumulative usage and privacy-safe topology", async () => {
    const store = storage();
    const app = integratedApp(store, new FixtureCollector(collection()));
    await app.inject({ method: "POST", url: "/api/sync/codex" });

    const response = await app.inject({ method: "GET", url: "/api/snapshot" });
    const snapshot = response.json();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "codex_observed_tokens", value: 190, completeness: "complete" }),
    ]));
    expect(snapshot.agents.map((agent: { sessionId: string }) => agent.sessionId)).toEqual(["session-parent", "session-child"]);
    expect(snapshot.agents[1]).toMatchObject({ parentSessionId: "session-parent", model: "gpt-5.6-sol", status: "running" });
    expect(snapshot.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSystem: "codex_local", status: "connected", completeness: "partial" }),
    ]));
    for (const prohibited of ["payload", "workspaceIdentityHash", "sourceSessionId", "rollout_path", "/Users/person", "PRIVATE"]) {
      expect(serialized).not.toContain(prohibited);
    }
  });

  it("keeps the agent row cap separate from the range-aware token aggregate", async () => {
    const store = storage();
    const app = integratedApp(store, new FixtureCollector(bulkCollection(501)));
    await app.inject({ method: "POST", url: "/api/sync/codex" });

    const snapshot = (await app.inject({ method: "GET", url: "/api/snapshot" })).json();
    const tokens = snapshot.summary.find((metric: { metric: string }) => metric.metric === "codex_observed_tokens");

    expect(snapshot.agents).toHaveLength(500);
    expect(tokens).toMatchObject({ value: 501, completeness: "complete" });
  });

  it("emits a contract-valid unknown metric when sessions have no trustworthy counters", async () => {
    const store = storage();
    const missingCounters = collection();
    missingCounters.events = missingCounters.events.filter((item) => item.eventType !== "codex.usage.recorded");
    missingCounters.coverage.usageSnapshotsObserved = 0;
    missingCounters.coverage.sessionsMissingCounters = missingCounters.sessions.length;
    const app = integratedApp(store, new FixtureCollector(missingCounters));
    await app.inject({ method: "POST", url: "/api/sync/codex" });

    const snapshot = (await app.inject({ method: "GET", url: "/api/snapshot" })).json();
    expect(snapshot.summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "codex_observed_tokens", value: null, completeness: "unknown" }),
    ]));
  });

  it("retains a numeric known subtotal when only some session counters are trustworthy", async () => {
    const store = storage();
    const partialCounters = collection();
    partialCounters.events = partialCounters.events.filter((item) =>
      item.eventType !== "codex.usage.recorded" || item.sessionId !== "session-child"
    );
    partialCounters.coverage.usageSnapshotsObserved = 2;
    partialCounters.coverage.sessionsMissingCounters = 1;
    const app = integratedApp(store, new FixtureCollector(partialCounters));
    await app.inject({ method: "POST", url: "/api/sync/codex" });

    const snapshot = (await app.inject({ method: "GET", url: "/api/snapshot" })).json();
    expect(snapshot.summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "codex_observed_tokens", value: 150, completeness: "partial" }),
    ]));
  });
});
