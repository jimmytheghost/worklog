import { useEffect, useState } from "react";

export type Metric = "commits" | "pushes";

export type DayActivity = {
  date: string;
  commits: number | null;
  pushes: number | null;
  aiAttributed: boolean;
};

export type DashboardSnapshot = {
  generatedAt: string;
  timezone: string;
  reportingRange: { start: string; end: string; formatted: string };
  metrics: readonly { label: string; value: string; delta: string; context: string }[];
  activityDays: DayActivity[];
  projects: readonly { name: string; branch: string; commits: number; status: string; agents: number; updated: string }[];
  agents: readonly { id: string; depth: number; name: string; meta: string; status: string; duration: string }[];
  recentActivity: readonly { id: string; time: string; title: string; subject: string; detail: string; source: string; tone: "lime" | "orange" }[];
  coverage: { commits: string; pushes: string };
  collectors: readonly { name: string; status: "healthy" | "partial" | "error" | "not_configured"; detail: string }[];
};

type ApiMetric = {
  metric: string;
  value: number | null;
  completeness: string;
  coverageStart?: string;
};

type ApiSnapshot = {
  schemaVersion: number;
  generatedAt: string;
  timezone: string;
  range: { start: string; end: string; timezone: string };
  summary: ApiMetric[];
  activityDays: Array<{ date: string; commits: number; pushes: number; codexAttributedCommits: number }>;
  projects: Array<{ projectId: string; name: string; branch: string; commits: number; lastActivityAt: string; status: string }>;
  agents: Array<{ sessionId: string; parentSessionId: string | null; projectId: string; label: string; model: string; status: string; startedAt: string; completedAt: string | null }>;
  recentActivity: Array<{ eventId: string; eventType: string; occurredAt: string; projectId: string | null; sourceSystem: string; confidence: string; summary: string }>;
  sources: Array<{ sourceSystem: string; status: string; freshness: string; completeness: string; lastSucceededAt: string | null }>;
};

export type SnapshotClient = (signal?: AbortSignal) => Promise<DashboardSnapshot>;
export type SnapshotRefreshSubscriber = (refresh: () => void) => () => void;

export type SnapshotState =
  | { status: "loading"; snapshot: null; error: null; usingFallback: false }
  | { status: "success"; snapshot: DashboardSnapshot; error: null; usingFallback: false }
  | { status: "error"; snapshot: DashboardSnapshot | null; error: Error; usingFallback: boolean };

const SOURCE_LABELS: Record<string, string> = {
  github: "GitHub",
  git_local: "Local Git",
  codex_local: "Codex",
  openai_usage: "OpenAI usage",
};

const EVENT_LABELS: Record<string, string> = {
  "github.push.observed": "Push observed",
  "codex.session.completed": "Sub-agent completed",
  "git.commit.discovered": "Commit discovered",
};

function isApiSnapshot(value: unknown): value is ApiSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ApiSnapshot>;
  return snapshot.schemaVersion === 1 && typeof snapshot.generatedAt === "string" && snapshot.range !== undefined && typeof snapshot.range.start === "string" && typeof snapshot.range.end === "string" && typeof snapshot.range.timezone === "string" && Array.isArray(snapshot.summary) && Array.isArray(snapshot.activityDays) && Array.isArray(snapshot.projects) && Array.isArray(snapshot.agents) && Array.isArray(snapshot.recentActivity) && Array.isArray(snapshot.sources);
}

function formatMetric(value: number | null, metric: string) {
  if (value === null) return "—";
  if (metric.includes("tokens")) {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  }
  return new Intl.NumberFormat("en-US").format(value);
}

function relativeTime(value: string, generatedAt: string) {
  const minutes = Math.max(0, Math.round((new Date(generatedAt).getTime() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function duration(start: string, end: string | null, generatedAt: string) {
  const minutes = Math.max(0, Math.round((new Date(end ?? generatedAt).getTime() - new Date(start).getTime()) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

function toTitle(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function agentDepths(agents: ApiSnapshot["agents"]) {
  const byId = new Map(agents.map((agent) => [agent.sessionId, agent]));
  const depths = new Map<string, number>();

  const visit = (sessionId: string, path = new Set<string>()): number => {
    const known = depths.get(sessionId);
    if (known !== undefined) return known;
    const agent = byId.get(sessionId);
    if (!agent?.parentSessionId || !byId.has(agent.parentSessionId) || path.has(sessionId)) {
      depths.set(sessionId, 0);
      return 0;
    }
    const nextPath = new Set(path).add(sessionId);
    const depth = visit(agent.parentSessionId, nextPath) + 1;
    depths.set(sessionId, depth);
    return depth;
  };

  for (const agent of agents) visit(agent.sessionId);
  return depths;
}

function localDateForInstant(value: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatRangeDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function reportingRange(range: ApiSnapshot["range"]) {
  const start = localDateForInstant(range.start, range.timezone);
  const finalInstant = new Date(new Date(range.end).getTime() - 1);
  const end = localDateForInstant(finalInstant, range.timezone);
  return { start, end, formatted: `${formatRangeDate(start)} — ${formatRangeDate(end)}` };
}

function activityCalendar(sourceDays: ApiSnapshot["activityDays"], range: ReturnType<typeof reportingRange>): DayActivity[] {
  const end = new Date(`${range.end}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 370);
  const observed = new Map(sourceDays.map((day) => [day.date, day]));

  return Array.from({ length: 371 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const day = observed.get(key);
    const isCovered = key >= range.start && key <= range.end;
    return {
      date: key,
      commits: day?.commits ?? (isCovered ? 0 : null),
      pushes: day?.pushes ?? (isCovered ? 0 : null),
      aiAttributed: Boolean(day && day.codexAttributedCommits > 0),
    };
  });
}

export function normalizeSnapshot(api: ApiSnapshot): DashboardSnapshot {
  const metricByName = new Map(api.summary.map((metric) => [metric.metric, metric]));
  const commitMetric = metricByName.get("commits");
  const pushMetric = metricByName.get("pushes");
  const agentCounts = new Map<string, number>();
  for (const agent of api.agents) agentCounts.set(agent.projectId, (agentCounts.get(agent.projectId) ?? 0) + 1);
  const sessionDepth = agentDepths(api.agents);
  const range = reportingRange(api.range);

  return {
    generatedAt: api.generatedAt,
    timezone: api.timezone,
    reportingRange: range,
    metrics: [
      { label: "Commits", value: formatMetric(commitMetric?.value ?? null, "commits"), delta: "Current", context: "selected range" },
      { label: "Pushes", value: formatMetric(pushMetric?.value ?? null, "pushes"), delta: "Observed", context: pushMetric?.completeness ?? "unknown" },
      { label: "Active days", value: formatMetric(metricByName.get("active_days")?.value ?? null, "active_days"), delta: "Local", context: "selected range" },
      { label: "Observed tokens", value: formatMetric(metricByName.get("codex_observed_tokens")?.value ?? null, "tokens"), delta: "Local", context: metricByName.has("codex_observed_tokens") ? "Observed locally — not billing usage" : "No local token metadata yet" },
    ],
    activityDays: activityCalendar(api.activityDays, range),
    projects: api.projects.map((project) => ({
      name: project.name,
      branch: project.branch,
      commits: project.commits,
      status: toTitle(project.status),
      agents: agentCounts.get(project.projectId) ?? 0,
      updated: relativeTime(project.lastActivityAt, api.generatedAt),
    })),
    agents: api.agents.map((agent) => ({
      id: agent.sessionId,
      depth: sessionDepth.get(agent.sessionId) ?? 0,
      name: agent.label,
      meta: `${agent.parentSessionId ? "Sub-agent" : "Codex"} · ${agent.model}`,
      status: agent.status === "completed" ? "Complete" : toTitle(agent.status),
      duration: duration(agent.startedAt, agent.completedAt, api.generatedAt),
    })),
    recentActivity: api.recentActivity.map((event) => ({
      id: event.eventId,
      time: new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: api.timezone }).format(new Date(event.occurredAt)),
      title: EVENT_LABELS[event.eventType] ?? toTitle(event.eventType.split(".").at(-1) ?? "Event"),
      subject: event.summary,
      detail: toTitle(event.confidence),
      source: SOURCE_LABELS[event.sourceSystem] ?? event.sourceSystem,
      tone: event.sourceSystem === "codex_local" ? "orange" : "lime",
    })),
    coverage: {
      commits: commitMetric?.completeness === "complete" ? "Complete commit history" : "Partial commit history",
      pushes: pushMetric?.coverageStart ? `Pushes observed since ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(pushMetric.coverageStart))}` : "Push coverage unknown",
    },
    collectors: api.sources.map((source) => ({
      name: SOURCE_LABELS[source.sourceSystem] ?? source.sourceSystem,
      status: source.status === "not_configured" ? "not_configured" : source.status !== "connected" || source.freshness === "stale" ? "error" : source.completeness === "partial" || source.completeness === "prospective" ? "partial" : "healthy",
      detail: source.lastSucceededAt ? `Last sync ${relativeTime(source.lastSucceededAt, api.generatedAt)} ago` : "Not connected",
    })),
  };
}

export function createSnapshotClient(fetcher: typeof fetch = fetch): SnapshotClient {
  return async (signal) => {
    const response = await fetcher("/api/snapshot", { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
    const payload: unknown = await response.json();
    if (!isApiSnapshot(payload)) throw new Error("Snapshot response did not match schema version 1");
    return normalizeSnapshot(payload);
  };
}

export const defaultSnapshotClient = createSnapshotClient();

const TERMINAL_SYNC_STATUSES = new Set(["succeeded", "partial", "failed"]);
const defaultEventSourceFactory = (url: string) => new EventSource(url);

export function subscribeToTerminalSyncs(
  refresh: () => void,
  createEventSource: (url: string) => EventSource = defaultEventSourceFactory,
): () => void {
  if (typeof EventSource === "undefined" && createEventSource === defaultEventSourceFactory) return () => undefined;
  const source = createEventSource("/api/events");
  const onSync = (event: Event) => {
    try {
      const payload: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (
        payload !== null
        && typeof payload === "object"
        && "status" in payload
        && typeof payload.status === "string"
        && TERMINAL_SYNC_STATUSES.has(payload.status)
      ) refresh();
    } catch {
      // Ignore malformed stream messages; the next valid terminal event can still refresh.
    }
  };
  source.addEventListener("github-sync", onSync);
  source.addEventListener("codex-sync", onSync);
  return () => source.close();
}

export function useSnapshot(
  client: SnapshotClient,
  fallback?: DashboardSnapshot,
  subscribe: SnapshotRefreshSubscriber = subscribeToTerminalSyncs,
  retryDelayMs = 1_000,
): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "loading", snapshot: null, error: null, usingFallback: false });

  useEffect(() => {
    let controller: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const load = () => {
      controller?.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      controller = new AbortController();
      const signal = controller.signal;

      client(signal).then(
        (snapshot) => {
          if (disposed || signal.aborted) return;
          setState({ status: "success", snapshot, error: null, usingFallback: false });
        },
        (reason: unknown) => {
          if (disposed || signal.aborted) return;
          const error = reason instanceof Error ? reason : new Error("The dashboard snapshot is unavailable");
          setState({ status: "error", snapshot: fallback ?? null, error, usingFallback: Boolean(fallback) });
          retryTimer = setTimeout(load, retryDelayMs);
        },
      );
    };

    setState({ status: "loading", snapshot: null, error: null, usingFallback: false });
    load();
    const unsubscribe = subscribe(load);
    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [client, fallback, retryDelayMs, subscribe]);

  return state;
}
