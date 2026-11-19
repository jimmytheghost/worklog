import { parseNormalizedEvent } from "@agent-dashboard/domain";
import { openStorage, type Storage } from "@agent-dashboard/storage";
import { afterEach, describe, expect, it } from "vitest";

import { CODEX_AGENT_COVERAGE_KEY, CODEX_COVERAGE_KEY, CODEX_SOURCE_ID } from "../src/codex-sync.js";
import { buildPeriodSummary } from "../src/period-summary.js";
import { buildPublicActivity } from "../src/public-activity.js";

const stores: Storage[] = [];
let sequence = 0;
afterEach(() => { for (const store of stores.splice(0)) store.close(); sequence = 0; });
function storage() {
  const store = openStorage({ filename: ":memory:" });
  store.upsertSource({ id: CODEX_SOURCE_ID, system: "codex_local", immutableSourceId: "local-test" });
  stores.push(store);
  return store;
}
function event(type: string, at: string, sessionId: string, payload: Record<string, unknown>) {
  sequence++;
  return parseNormalizedEvent({
    eventId: `test-${sequence}`, eventType: type, schemaVersion: 1,
    entityType: "codex_session", entityId: sessionId, sessionId,
    occurredAt: at, occurredAtSource: "source", observedAt: at,
    sourceSystem: "codex_local", sourceAccountId: "PRIVATE_ACCOUNT", sourceRecordId: `private-${sequence}`,
    adapterName: "test", adapterVersion: "1.0.0", idempotencyKey: `test-${sequence}`,
    attribution: "codex", confidence: "confirmed", completeness: "partial", payload,
  });
}
function session(store: Storage, id: string, start: string, usageAt: string, tokens: number | null) {
  store.upsertTokenBuckets([{ sessionId: id, instant: usageAt.slice(0, 16) + ":00.000Z", tokens, partial: tokens === null }]);
  store.insertEvents([
    event("codex.session.started", start, id, { sourceSessionId: id, agentRole: "primary" }),
    event("codex.usage.recorded", usageAt, id, {
      counterKind: "cumulative", sourceSessionId: id, bucketStart: start, bucketEnd: usageAt,
      ...(tokens === null ? { countersAvailable: false } : {
        totalTokens: tokens, inputTokens: tokens, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
      }),
    }),
  ]);
}
function coverage(store: Storage, end: string, completeness: "complete" | "partial" = "complete") {
  for (const [coverageKey, metric] of [[CODEX_COVERAGE_KEY, "codex_observed_tokens"], [CODEX_AGENT_COVERAGE_KEY, "codex_agent_activity"]]) {
    store.upsertCoverage({ coverageKey: coverageKey!, sourceId: CODEX_SOURCE_ID, metric: metric!,
      coverageStart: "2026-01-01T00:00:00.000Z", coverageEnd: end,
      lastSucceededAt: end, completeness }, end);
  }
}
function activity(store: Storage, id: string, at: string, role: "primary" | "subagent" = "primary") {
  store.insertEvents([event("codex.session.activity_observed", at, id, { sourceSessionId: id, agentRole: role })]);
}

describe("public rolling 24-hour observations", () => {
  it("aligns four windows to shared UTC quarter-hours across a DST transition", () => {
    const snapshot = buildPublicActivity(storage(), "America/Denver", new Date("2026-11-01T09:07:54.321Z"));
    expect(snapshot.rolling24Hours.map(({ end }) => end)).toEqual([
      "2026-11-01T09:00:00.000Z", "2026-11-01T08:45:00.000Z", "2026-11-01T08:30:00.000Z", "2026-11-01T08:15:00.000Z",
    ]);
    for (const { start, end } of snapshot.rolling24Hours) expect(Date.parse(end) - Date.parse(start)).toBe(86_400_000);
  });

  it("includes the exact start and excludes the exact end for tokens and agents", () => {
    const store = storage();
    const start = "2026-11-16T22:30:00.000Z", end = "2026-11-17T22:30:00.000Z";
    coverage(store, end);
    session(store, "PRIVATE_OLD", "2026-11-16T22:29:59.999Z", start, 1000);
    session(store, "PRIVATE_START", start, start, 10);
    session(store, "PRIVATE_LAST", "2026-11-17T22:29:59.998Z", "2026-11-17T22:29:59.999Z", 20);
    session(store, "PRIVATE_END", end, end, 1000);
    activity(store, "PRIVATE_OLD", "2026-11-16T22:29:59.999Z");
    activity(store, "PRIVATE_START", start);
    activity(store, "PRIVATE_LAST", "2026-11-17T22:29:59.999Z", "subagent");
    activity(store, "PRIVATE_END", end);
    const snapshot = buildPublicActivity(store, "America/Denver", new Date("2026-11-17T22:37:00.000Z"));
    expect(snapshot.rolling24Hours[0]).toEqual({
      start, end, tokens: 1030, tokensKnowledge: "complete", agents: 1, subagents: 1,
      agentDays: [{ localDate: "2026-11-16", agents: 1, subagents: 0 }, { localDate: "2026-11-17", agents: 0, subagents: 1 }],
    });
    expect(snapshot.months[0]?.tokenDays).toEqual([
      { localDate: "2026-11-16", tokens: 1010, tokensKnowledge: "complete" },
      { localDate: "2026-11-17", tokens: 1020, tokensKnowledge: "complete" },
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_|sourceSessionId|sessionId|sourceAccountId|prompt|response|credential/);
  });

  it("assigns a reopened session to both Denver dates in the website and native totals", () => {
    const store = storage();
    const now = new Date("2026-11-17T08:00:00.000Z");
    session(store, "PRIVATE_RESUMED", "2026-11-17T06:00:00.000Z", "2026-11-17T06:59:00.000Z", 80);
    store.upsertTokenBuckets([{ sessionId: "PRIVATE_RESUMED", instant: "2026-11-17T07:00:00.000Z", tokens: 15, partial: false }]);
    const timeZone = "America/Denver";
    const today = buildPeriodSummary(store, { period: "day", timeZone, now });
    expect(today.metrics).toMatchObject({ tokens: 15, tokensKnowledge: "complete" });
    expect(buildPublicActivity(store, timeZone, now).months[0]).toMatchObject({
      tokens: 95,
      tokenDays: [
        { localDate: "2026-11-16", tokens: 80, tokensKnowledge: "complete" },
        { localDate: "2026-11-17", tokens: 15, tokensKnowledge: "complete" },
      ],
    });
  });

  it("keeps unavailable tokens distinct from observed zero", () => {
    const store = storage();
    const at = new Date("2026-11-17T22:37:00.000Z");
    expect(buildPublicActivity(store, "UTC", at).rolling24Hours[0]).toMatchObject({ tokens: null, tokensKnowledge: "unknown", agents: null, subagents: null });
    coverage(store, at.toISOString());
    expect(buildPublicActivity(store, "UTC", at).rolling24Hours[0]).toMatchObject({ tokens: 0, tokensKnowledge: "complete", agents: 0, subagents: 0 });
    session(store, "PRIVATE_ZERO", "2026-11-17T12:00:00.000Z", "2026-11-17T12:01:00.000Z", 0);
    expect(buildPublicActivity(store, "UTC", at).rolling24Hours[0]).toMatchObject({ tokens: 0, tokensKnowledge: "complete" });
  });

  it("preserves unknown counters and partial observed subtotals", () => {
    const store = storage();
    const at = new Date("2026-11-17T22:37:00.000Z");
    coverage(store, at.toISOString());
    session(store, "PRIVATE_UNKNOWN", "2026-11-17T12:00:00.000Z", "2026-11-17T12:01:00.000Z", null);
    expect(buildPublicActivity(store, "UTC", at).rolling24Hours[0]).toMatchObject({ tokens: null, tokensKnowledge: "unknown" });
    session(store, "PRIVATE_KNOWN", "2026-11-17T13:00:00.000Z", "2026-11-17T13:01:00.000Z", 45);
    expect(buildPublicActivity(store, "UTC", at).rolling24Hours[0]).toMatchObject({ tokens: 45, tokensKnowledge: "partial" });
  });

  it("qualifies a zero from incomplete or not-yet-current coverage as partial", () => {
    const store = storage(), at = new Date("2026-11-17T22:37:00.000Z");
    coverage(store, "2026-11-17T22:29:00.000Z");
    expect(buildPublicActivity(store, "UTC", at).rolling24Hours[0]).toMatchObject({ tokens: 0, tokensKnowledge: "partial" });
    coverage(store, at.toISOString(), "partial");
    expect(buildPublicActivity(store, "UTC", at).rolling24Hours[0]).toMatchObject({ tokens: 0, tokensKnowledge: "partial" });
  });
});
