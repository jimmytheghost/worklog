import { CodexAccountCollectorError } from "@agent-dashboard/collector-codex";
import type { CodexAccountUsageSnapshot } from "@agent-dashboard/domain";
import { openStorage, type Storage } from "@agent-dashboard/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const observedAt = "2026-09-01T12:00:00.000Z";
const apps: ReturnType<typeof buildApp>[] = [];
const stores: Storage[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const storage of stores.splice(0)) storage.close();
});

function accountSnapshot(): CodexAccountUsageSnapshot {
  return {
    sourceInstanceId: "a".repeat(64),
    observedAt,
    planType: "pro",
    rateLimits: [{
      limitId: "codex",
      limitName: null,
      planType: "pro",
      primary: { usedPercent: 44, windowDurationMinutes: 10080, resetsAt: "2026-09-07T02:28:17.000Z" },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: "0" },
      individualLimit: null,
      spendControlReached: false,
      rateLimitReachedType: null,
    }],
    bankedResetCount: 1,
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    tokenUsage: {
      lifetimeTokens: 1_234_567,
      peakDailyTokens: 45_678,
      longestRunningTurnSeconds: 540,
      currentStreakDays: 8,
      longestStreakDays: 14,
      daily: [{ date: "2026-09-01", tokens: 12_345 }],
    },
  };
}

describe("Codex account usage integration", () => {
  it("syncs and serves remaining usage, account tokens, credits, and banked resets", async () => {
    const storage = openStorage({ filename: ":memory:" });
    stores.push(storage);
    const app = buildApp({
      storage,
      codexAccountCollector: { collect: async () => accountSnapshot() },
      fixtureMode: false,
      now: () => new Date(observedAt),
    });
    apps.push(app);

    const sync = await app.inject({ method: "POST", url: "/api/sync/codex" });
    const snapshot = (await app.inject({ method: "GET", url: "/api/snapshot" })).json();

    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toMatchObject({ status: "succeeded", limits: 1, bankedResetCount: 1 });
    expect(snapshot.codexAccount).toMatchObject({
      planType: "pro",
      bankedResetCount: 1,
      credits: { balance: "0" },
      tokenUsage: { lifetimeTokens: 1_234_567 },
      rateLimits: [{ primary: { usedPercent: 44 } }],
    });
    expect(snapshot.sources).toContainEqual(expect.objectContaining({
      sourceSystem: "codex_account",
      status: "connected",
    }));
    expect(JSON.stringify(snapshot)).not.toContain("sourceInstanceId");
  });

  it("preserves the last successful snapshot when a later refresh fails", async () => {
    const storage = openStorage({ filename: ":memory:" });
    stores.push(storage);
    let calls = 0;
    const app = buildApp({
      storage,
      codexAccountCollector: {
        collect: async () => {
          calls += 1;
          if (calls === 1) return accountSnapshot();
          throw new CodexAccountCollectorError("protocol_error", "PRIVATE backend details");
        },
      },
      fixtureMode: false,
      now: () => new Date(observedAt),
    });
    apps.push(app);

    await app.inject({ method: "POST", url: "/api/sync/codex" });
    const failed = await app.inject({ method: "POST", url: "/api/sync/codex" });
    const snapshot = (await app.inject({ method: "GET", url: "/api/snapshot" })).json();

    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({
      error: { code: "protocol_error", message: "Codex account usage is unavailable from this CLI version" },
    });
    expect(failed.body).not.toContain("PRIVATE");
    expect(snapshot.codexAccount.bankedResetCount).toBe(1);
  });
});
