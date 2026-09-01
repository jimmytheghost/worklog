import { describe, expect, it } from "vitest";

import { normalizeCodexAccountUsage } from "../src/app-server.js";

describe("Codex account App Server normalization", () => {
  it("keeps quota, token, credit, and banked-reset facts while hashing identity", () => {
    const snapshot = normalizeCodexAccountUsage(
      { account: { type: "chatgpt", email: "private@example.com", planType: "pro" }, requiresOpenaiAuth: true },
      {
        rateLimits: { limitId: "codex", primary: { usedPercent: 44, windowDurationMins: 10080, resetsAt: 1788748097 } },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            primary: { usedPercent: 44, windowDurationMins: 10080, resetsAt: 1788748097 },
            credits: { hasCredits: true, unlimited: false, balance: "12.50" },
            spendControlReached: false,
          },
          spark: {
            limitId: "spark",
            limitName: "Codex Spark",
            primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1788298730 },
          },
        },
        rateLimitResetCredits: { availableCount: 1, credits: null },
      },
      {
        summary: { lifetimeTokens: 1_234_567, peakDailyTokens: 45_678, currentStreakDays: 8 },
        dailyUsageBuckets: [{ startDate: "2026-08-31", tokens: 12_345 }],
      },
      "2026-09-01T12:00:00.000Z",
    );

    expect(snapshot).toMatchObject({
      planType: "pro",
      bankedResetCount: 1,
      credits: { balance: "12.50" },
      tokenUsage: { lifetimeTokens: 1_234_567, peakDailyTokens: 45_678 },
    });
    expect(snapshot.rateLimits[0]).toMatchObject({
      limitId: "codex",
      primary: { usedPercent: 44, windowDurationMinutes: 10080, resetsAt: "2026-09-07T02:28:17.000Z" },
    });
    expect(snapshot.tokenUsage.daily).toEqual([{ date: "2026-08-31", tokens: 12_345 }]);
    expect(JSON.stringify(snapshot)).not.toContain("private@example.com");
    expect(snapshot.sourceInstanceId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("falls back to the backward-compatible single rate-limit bucket", () => {
    const snapshot = normalizeCodexAccountUsage(
      { account: { type: "chatgpt" } },
      { rateLimits: { primary: { usedPercent: 20 } }, rateLimitResetCredits: null },
      { summary: {}, dailyUsageBuckets: null },
      "2026-09-01T12:00:00.000Z",
    );

    expect(snapshot.rateLimits).toHaveLength(1);
    expect(snapshot.rateLimits[0]).toMatchObject({ limitId: "codex", primary: { usedPercent: 20 } });
    expect(snapshot.bankedResetCount).toBeNull();
    expect(snapshot.tokenUsage.daily).toBeNull();
  });
});
