type Completeness = "complete" | "partial" | "prospective" | "unavailable" | "unknown";
type Freshness = "fresh" | "stale" | "never";

type MetricFixture = {
  metric: string;
  value: number | null;
  unit: "count" | "tokens" | "milliseconds" | "currency";
  interval: {
    start: string;
    end: string;
    timezone: string;
  };
  dimensions: Record<string, string>;
  sourceSystems: string[];
  completeness: Completeness;
  coverageStart?: string;
  coverageEnd?: string;
  coverageReason?: string;
  lastSucceededAt?: string;
  freshness: Freshness;
};

const interval = {
  start: "2026-08-24T06:00:00.000Z",
  end: "2026-08-31T06:00:00.000Z",
  timezone: "America/Denver",
} as const;

const summary: MetricFixture[] = [
  {
    metric: "commits",
    value: 18,
    unit: "count",
    interval,
    dimensions: {},
    sourceSystems: ["git_local", "github"],
    completeness: "complete",
    coverageStart: "2026-08-24T06:00:00.000Z",
    coverageEnd: "2026-08-31T06:00:00.000Z",
    lastSucceededAt: "2026-08-31T03:58:00.000Z",
    freshness: "fresh",
  },
  {
    metric: "pushes",
    value: 7,
    unit: "count",
    interval,
    dimensions: {},
    sourceSystems: ["github"],
    completeness: "prospective",
    coverageStart: "2026-08-24T06:00:00.000Z",
    coverageEnd: "2026-08-31T06:00:00.000Z",
    coverageReason: "Observed push collection began on August 24, 2026.",
    lastSucceededAt: "2026-08-31T03:58:00.000Z",
    freshness: "fresh",
  },
  {
    metric: "active_days",
    value: 5,
    unit: "count",
    interval,
    dimensions: {},
    sourceSystems: ["git_local", "github"],
    completeness: "complete",
    coverageStart: "2026-08-24T06:00:00.000Z",
    coverageEnd: "2026-08-31T06:00:00.000Z",
    lastSucceededAt: "2026-08-31T03:58:00.000Z",
    freshness: "fresh",
  },
  {
    metric: "codex_observed_tokens",
    value: 238_400,
    unit: "tokens",
    interval,
    dimensions: { usageNamespace: "codex_local" },
    sourceSystems: ["codex_local"],
    completeness: "partial",
    coverageStart: "2026-08-25T14:00:00.000Z",
    coverageEnd: "2026-08-31T06:00:00.000Z",
    coverageReason: "Some local sessions do not expose every token counter class.",
    lastSucceededAt: "2026-08-31T03:59:00.000Z",
    freshness: "fresh",
  },
];

export const snapshotFixture = {
  schemaVersion: 1,
  generatedAt: "2026-08-31T04:00:00.000Z",
  timezone: "America/Denver",
  range: interval,
  summary,
  activityDays: [
    { date: "2026-08-24", commits: 2, pushes: 1, codexAttributedCommits: 1 },
    { date: "2026-08-25", commits: 5, pushes: 2, codexAttributedCommits: 4 },
    { date: "2026-08-26", commits: 0, pushes: 0, codexAttributedCommits: 0 },
    { date: "2026-08-27", commits: 3, pushes: 1, codexAttributedCommits: 2 },
    { date: "2026-08-28", commits: 6, pushes: 2, codexAttributedCommits: 5 },
    { date: "2026-08-29", commits: 0, pushes: 0, codexAttributedCommits: 0 },
    { date: "2026-08-30", commits: 2, pushes: 1, codexAttributedCommits: 2 },
  ],
  projects: [
    {
      projectId: "repo:github:101",
      name: "agent-dashboard",
      owner: "JimmyTheGhost",
      branch: "main",
      commits: 9,
      pushes: 3,
      lastActivityAt: "2026-08-31T03:52:00.000Z",
      status: "active",
    },
    {
      projectId: "repo:github:102",
      name: "agentic-toolkit",
      owner: "JimmyTheGhost",
      branch: "main",
      commits: 6,
      pushes: 3,
      lastActivityAt: "2026-08-30T21:15:00.000Z",
      status: "active",
    },
    {
      projectId: "repo:github:103",
      name: "ryders-guitar-lab",
      owner: "JimmyTheGhost",
      branch: "main",
      commits: 3,
      pushes: 1,
      lastActivityAt: "2026-08-28T17:34:00.000Z",
      status: "quiet",
    },
  ],
  agents: [
    {
      sessionId: "session:dashboard-root",
      parentSessionId: null,
      projectId: "repo:github:101",
      label: "Build dashboard foundation",
      model: "gpt-5",
      status: "running",
      startedAt: "2026-08-31T03:20:00.000Z",
      completedAt: null,
      observedTokens: 61_200,
    },
    {
      sessionId: "session:dashboard-service",
      parentSessionId: "session:dashboard-root",
      projectId: "repo:github:101",
      label: "Scaffold local service",
      model: "gpt-5",
      status: "completed",
      startedAt: "2026-08-31T03:25:00.000Z",
      completedAt: "2026-08-31T03:47:00.000Z",
      observedTokens: 18_450,
    },
    {
      sessionId: "session:dashboard-ui",
      parentSessionId: "session:dashboard-root",
      projectId: "repo:github:101",
      label: "Compose overview shell",
      model: "gpt-5",
      status: "running",
      startedAt: "2026-08-31T03:26:00.000Z",
      completedAt: null,
      observedTokens: 24_800,
    },
  ],
  recentActivity: [
    {
      eventId: "event:push:1001",
      eventType: "github.push.observed",
      occurredAt: "2026-08-31T03:52:00.000Z",
      projectId: "repo:github:101",
      sourceSystem: "github",
      attribution: "codex",
      confidence: "correlated",
      summary: "Push observed on agent-dashboard/main",
    },
    {
      eventId: "event:session:1002",
      eventType: "codex.session.completed",
      occurredAt: "2026-08-31T03:47:00.000Z",
      projectId: "repo:github:101",
      sourceSystem: "codex_local",
      attribution: "codex",
      confidence: "confirmed",
      summary: "Service sub-agent completed",
    },
    {
      eventId: "event:commit:1003",
      eventType: "git.commit.discovered",
      occurredAt: "2026-08-31T03:42:00.000Z",
      projectId: "repo:github:101",
      sourceSystem: "git_local",
      attribution: "unknown",
      confidence: "unknown",
      summary: "Two commits discovered in agent-dashboard",
    },
  ],
  sources: [
    {
      sourceSystem: "github",
      status: "connected",
      freshness: "fresh",
      lastSucceededAt: "2026-08-31T03:58:00.000Z",
      completeness: "prospective",
    },
    {
      sourceSystem: "git_local",
      status: "connected",
      freshness: "fresh",
      lastSucceededAt: "2026-08-31T03:58:00.000Z",
      completeness: "complete",
    },
    {
      sourceSystem: "codex_local",
      status: "connected",
      freshness: "fresh",
      lastSucceededAt: "2026-08-31T03:59:00.000Z",
      completeness: "partial",
    },
    {
      sourceSystem: "openai_usage",
      status: "not_configured",
      freshness: "never",
      lastSucceededAt: null,
      completeness: "unavailable",
    },
  ],
} as const;

export type Snapshot = typeof snapshotFixture;
