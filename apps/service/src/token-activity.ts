import type { CodexTokenKnowledge, Storage } from "@agent-dashboard/storage";

type TokenDay = ReturnType<Storage["queryDailyObservedTokens"]>[number];

export function sumTokenDays(days: readonly TokenDay[]): { tokens: number | null; tokensKnowledge: CodexTokenKnowledge } {
  let tokens: number | null = null;
  for (const day of days) {
    if (day.tokens !== null) tokens = (tokens ?? 0) + day.tokens;
  }
  return {
    tokens,
    tokensKnowledge: tokens === null ? "unknown"
      : days.every((day) => day.tokensKnowledge === "complete") ? "complete" : "partial",
  };
}
