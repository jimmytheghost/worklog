import type { DashboardSnapshot, DayActivity } from "./data/snapshot";

export const metrics = [
  { label: "Commits", value: "1,284", delta: "+18%", context: "this year" },
  { label: "Pushes", value: "418", delta: "+42", context: "observed" },
  { label: "Active days", value: "226", delta: "62%", context: "of the year" },
  { label: "Observed tokens", value: "18.4M", delta: "Local", context: "Observed locally — not billing usage" },
] as const;

export const projects = [
  { name: "agent-dashboard", branch: "main", commits: 12, status: "Active", agents: 3, updated: "4m" },
  { name: "agentic-toolkit", branch: "feat/event-ledger", commits: 8, status: "Active", agents: 2, updated: "38m" },
  { name: "ryders-guitar-lab", branch: "main", commits: 4, status: "Quiet", agents: 0, updated: "3h" },
  { name: "jimmyweber.com", branch: "content/refresh", commits: 3, status: "Quiet", agents: 1, updated: "7h" },
] as const;

export const agentTree = [
  { id: "fixture-root", depth: 0, name: "Build agent dashboard", meta: "Codex · gpt-5", status: "Running", duration: "34m" },
  { id: "fixture-ledger", depth: 1, name: "Define event ledger", meta: "Data agent", status: "Complete", duration: "18m" },
  { id: "fixture-ui", depth: 1, name: "Build overview UI", meta: "UI agent", status: "Running", duration: "12m" },
  { id: "fixture-a11y", depth: 2, name: "Audit accessibility", meta: "QA sub-agent", status: "Queued", duration: "—" },
] as const;

export const activity = [
  { id: "fixture-push", time: "22:18", title: "Push observed", subject: "agent-dashboard / main", detail: "3 commits", source: "GitHub", tone: "lime" },
  { id: "fixture-agent-completed", time: "21:54", title: "Sub-agent completed", subject: "Define event ledger", detail: "18m", source: "Codex", tone: "orange" },
  { id: "fixture-commit", time: "21:43", title: "Commit discovered", subject: "agentic-toolkit", detail: "b42d9ac", source: "Local Git", tone: "lime" },
  { id: "fixture-agent-linked", time: "20:09", title: "Agent linked", subject: "ryders-guitar-lab", detail: "Correlated", source: "Codex", tone: "orange" },
] as const;

function pseudoCount(index: number, salt: number): number {
  const signal = Math.abs(Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453) % 1;
  if (signal < 0.38) return 0;
  if (signal < 0.62) return 1;
  if (signal < 0.79) return 2;
  if (signal < 0.91) return 4;
  return 7 + (index % 6);
}

export function createActivityDays(today = new Date("2026-08-30T12:00:00-06:00")): DayActivity[] {
  const days: DayActivity[] = [];
  const start = new Date(today);
  start.setDate(today.getDate() - 370 - today.getDay());

  for (let index = 0; index < 371; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const isFuture = current > today;
    const commits = isFuture ? null : pseudoCount(index, 2);
    const pushes = isFuture ? null : Math.min(4, Math.floor(pseudoCount(index, 7) / 2));
    days.push({
      date: current.toISOString().slice(0, 10),
      commits,
      pushes,
      aiAttributed: !isFuture && index > 240 && index % 7 < 3 && (commits ?? 0) > 0,
    });
  }

  return days;
}

export const dashboardFixture: DashboardSnapshot = {
  generatedAt: "2026-08-31T04:00:00.000Z",
  timezone: "America/Denver",
  codexAccount: {
    observedAt: "2026-08-31T04:00:00.000Z",
    planType: "pro",
    rateLimits: [{
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: 44, windowDurationMinutes: 10080, resetsAt: "2026-09-07T02:28:17.000Z" },
      secondary: null,
    }],
    bankedResetCount: 1,
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    tokenUsage: {
      lifetimeTokens: 4280300000,
      peakDailyTokens: 18400000,
      longestRunningTurnSeconds: 540,
      currentStreakDays: 8,
      longestStreakDays: 21,
    },
  },
  reportingRange: { start: "2025-09-01", end: "2026-08-30", formatted: "Sep 1, 2025 — Aug 30, 2026" },
  metrics,
  activityDays: createActivityDays(),
  projects,
  agents: agentTree,
  recentActivity: activity,
  coverage: { commits: "Complete commit history", pushes: "Pushes observed since May 14, 2026" },
  collectors: [
    { name: "GitHub", status: "partial", detail: "Push history is prospective" },
    { name: "Local Git", status: "healthy", detail: "Last sync 2m ago" },
    { name: "Codex", status: "healthy", detail: "Last sync 1m ago" },
    { name: "OpenAI usage", status: "not_configured", detail: "Optional source" },
  ],
};
