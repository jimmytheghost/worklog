import type { Storage } from "@agent-dashboard/storage";

import { CODEX_AGENT_COVERAGE_KEY } from "./codex-sync.js";

export function buildAgentActivity(
  storage: Pick<Storage, "getCoverage" | "queryDailyCodexAgentActivity">,
  range: { start: string; end: string },
  timeZone: string,
  now?: Date,
) {
  const coverage = storage.getCoverage(CODEX_AGENT_COVERAGE_KEY, now);
  const days = storage.queryDailyCodexAgentActivity({ ...range, timeZone });
  const hasCoverage = coverage?.coverageStart !== undefined && coverage.coverageEnd !== undefined
    && range.end > coverage.coverageStart && range.start <= coverage.coverageEnd;
  return {
    days,
    coverage,
    agents: hasCoverage || days.length > 0 ? days.reduce((sum, day) => sum + day.agents, 0) : null,
    subagents: hasCoverage || days.length > 0 ? days.reduce((sum, day) => sum + day.subagents, 0) : null,
  };
}
