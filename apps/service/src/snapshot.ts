import {
  localDateForInstant,
  parseMetricResult,
  utcRangeForLocalDate,
  type AnyNormalizedEvent,
  type EventPayloads,
  type MetricResult,
} from "@agent-dashboard/domain";
import type { Storage } from "@agent-dashboard/storage";

import { GITHUB_SOURCE_ID } from "./github-sync.js";
import { CODEX_COVERAGE_KEY } from "./codex-sync.js";
import { CODEX_ACCOUNT_COVERAGE_KEY } from "./codex-account-sync.js";

type SnapshotStorage = Pick<
  Storage,
  | "getCoverage"
  | "listProjects"
  | "listGitActivityEvents"
  | "queryDailyGitActivity"
  | "queryCodexObservedTokens"
  | "listRecentCodexSessions"
  | "getCodexAccountUsage"
>;

const DAYS_IN_SNAPSHOT = 365;

function addLocalDays(localDate: string, amount: number): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function worstCompleteness(left: string, right: string) {
  const rank = new Map([
    ["complete", 0],
    ["prospective", 1],
    ["partial", 2],
    ["unknown", 3],
    ["unavailable", 4],
  ]);
  return (rank.get(left) ?? 4) >= (rank.get(right) ?? 4) ? left : right;
}

function eventSummary(
  event: AnyNormalizedEvent,
  projectName: string,
): string {
  switch (event.eventType) {
    case "git.commit.discovered": {
      const payload = event.payload as EventPayloads["git.commit.discovered"];
      return payload.subject ?? `Commit ${payload.sha.slice(0, 7)} in ${projectName}`;
    }
    case "github.push.observed":
      return `Push observed on ${projectName}/${(event.payload as EventPayloads["github.push.observed"]).ref.replace("refs/heads/", "")}`;
    case "repository.discovered":
      return `Repository discovered: ${projectName}`;
    default:
      return `${event.eventType} in ${projectName}`;
  }
}

export function buildStorageSnapshot(
  storage: SnapshotStorage,
  options: { timeZone: string; now?: Date },
) {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const endLocalDateExclusive = addLocalDays(localDateForInstant(now, options.timeZone), 1);
  const startLocalDate = addLocalDays(endLocalDateExclusive, -DAYS_IN_SNAPSHOT);
  const range = {
    start: utcRangeForLocalDate(startLocalDate, options.timeZone).start,
    end: utcRangeForLocalDate(endLocalDateExclusive, options.timeZone).start,
    timezone: options.timeZone,
  };
  const commitCoverage = storage.getCoverage(`${GITHUB_SOURCE_ID}:commits`, now);
  const pushCoverage = storage.getCoverage(`${GITHUB_SOURCE_ID}:pushes`, now);
  const codexCoverage = storage.getCoverage(CODEX_COVERAGE_KEY, now);
  const codexAccountCoverage = storage.getCoverage(CODEX_ACCOUNT_COVERAGE_KEY, now);
  const codexAccount = storage.getCodexAccountUsage();
  const hasGitHubData = commitCoverage !== undefined || pushCoverage !== undefined;
  const activity = hasGitHubData
    ? storage.queryDailyGitActivity({
        startLocalDate,
        endLocalDateExclusive,
        timeZone: options.timeZone,
      })
    : [];
  const commitCount = commitCoverage !== undefined
    ? activity.reduce((total, day) => total + day.commits, 0)
    : null;
  const pushCount = pushCoverage !== undefined
    ? activity.reduce((total, day) => total + day.pushes, 0)
    : null;
  const activeDays = commitCoverage !== undefined
    ? activity.filter((day) => day.commits > 0 || day.pushes > 0).length
    : null;
  const codexSessions = storage.listRecentCodexSessions(12);
  const codexTokenAggregate = storage.queryCodexObservedTokens({
    start: range.start,
    end: range.end,
  });

  const metric = (
    name: string,
    value: number | null,
    sourceSystems: MetricResult["sourceSystems"],
    coverage: typeof commitCoverage,
  ): MetricResult => parseMetricResult({
    metric: name,
    value: coverage === undefined ? null : value,
    unit: "count",
    interval: range,
    dimensions: {},
    sourceSystems,
    completeness: coverage?.completeness ?? "unavailable",
    ...(coverage?.coverageStart === undefined ? {} : { coverageStart: coverage.coverageStart }),
    ...(coverage?.coverageEnd === undefined ? {} : { coverageEnd: coverage.coverageEnd }),
    ...(coverage?.coverageReason === undefined ? {} : { coverageReason: coverage.coverageReason }),
    ...(coverage?.lastSucceededAt === undefined
      ? {}
      : { lastSucceededAt: coverage.lastSucceededAt }),
    freshness: coverage?.freshness ?? "never",
  });

  const codexTokenMetric = parseMetricResult({
    metric: "codex_observed_tokens",
    value:
      codexCoverage === undefined || codexTokenAggregate.knowledge === "unknown"
        ? null
        : codexTokenAggregate.knownSubtotal,
    unit: "tokens",
    interval: range,
    dimensions: { usageNamespace: "codex_local" },
    sourceSystems: ["codex_local"],
    completeness:
      codexCoverage === undefined ? "unavailable" : codexTokenAggregate.knowledge,
    ...(codexCoverage?.coverageEnd === undefined ? {} : { coverageEnd: codexCoverage.coverageEnd }),
    ...(codexCoverage?.coverageReason === undefined
      ? {}
      : { coverageReason: codexCoverage.coverageReason }),
    ...(codexCoverage?.lastSucceededAt === undefined
      ? {}
      : { lastSucceededAt: codexCoverage.lastSucceededAt }),
    freshness: codexCoverage?.freshness ?? "never",
  });

  const gitEvents = storage.listGitActivityEvents({ start: range.start, end: range.end });
  const recentEvents = gitEvents.slice(0, 100);
  const projects = storage.listProjects();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const latestProjectEvents = new Map<string, string>();
  for (const event of gitEvents) {
    if (event.repositoryId !== undefined && !latestProjectEvents.has(event.repositoryId)) {
      latestProjectEvents.set(event.repositoryId, event.occurredAt);
    }
  }

  const projectRows = projects
    .map((project) => {
      const projectActivity = hasGitHubData
        ? storage.queryDailyGitActivity({
            startLocalDate,
            endLocalDateExclusive,
            timeZone: options.timeZone,
            repositoryIds: [project.id],
          })
        : [];
      const commits = projectActivity.reduce((total, day) => total + day.commits, 0);
      return {
        projectId: project.id,
        name: project.name,
        branch: project.defaultBranch ?? "unknown",
        commits,
        lastActivityAt: latestProjectEvents.get(project.id) ?? project.updatedAt,
        status: latestProjectEvents.has(project.id) ? "active" : "quiet",
      };
    })
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
    .slice(0, 7);

  const githubCompleteness = worstCompleteness(
    commitCoverage?.completeness ?? "unavailable",
    pushCoverage?.completeness ?? "unavailable",
  );
  const githubLastSucceededAt = [commitCoverage?.lastSucceededAt, pushCoverage?.lastSucceededAt]
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);

  return {
    schemaVersion: 1,
    generatedAt,
    timezone: options.timeZone,
    range,
    codexAccount: codexAccount === undefined ? null : {
      observedAt: codexAccount.observedAt,
      planType: codexAccount.planType,
      rateLimits: codexAccount.rateLimits,
      bankedResetCount: codexAccount.bankedResetCount,
      credits: codexAccount.credits,
      tokenUsage: codexAccount.tokenUsage,
    },
    summary: [
      metric("commits", commitCount, ["github"], commitCoverage),
      metric("pushes", pushCount, ["github"], pushCoverage),
      metric("active_days", activeDays, ["github"], commitCoverage),
      metric(
        "active_projects",
        commitCoverage === undefined
          ? null
          : projectRows.filter((project) => project.status === "active").length,
        ["github"],
        commitCoverage,
      ),
      codexTokenMetric,
    ],
    activityDays: activity.map((day) => ({
      date: day.localDate,
      commits: day.commits,
      pushes: day.pushes,
      codexAttributedCommits: 0,
    })),
    projects: projectRows,
    agents: codexSessions.map((session) => ({
      sessionId: session.id,
      parentSessionId: session.parentSessionId,
      projectId: session.repositoryId ?? "",
      label:
        session.label ?? (session.parentSessionId === null ? "Codex task" : "Codex sub-agent"),
      model: session.model ?? "Unknown model",
      status: session.status === "active" ? "running" : session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    })),
    recentActivity: recentEvents.slice(0, 20).map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      projectId: event.repositoryId ?? null,
      sourceSystem: event.sourceSystem,
      confidence: event.confidence,
      summary: eventSummary(
        event,
        event.repositoryId === undefined
          ? "unknown project"
          : (projectNames.get(event.repositoryId) ?? "unknown project"),
      ),
    })),
    sources: [
      {
        sourceSystem: "github",
        status: hasGitHubData ? "connected" : "not_configured",
        freshness:
          commitCoverage?.freshness === "stale" || pushCoverage?.freshness === "stale"
            ? "stale"
            : githubLastSucceededAt === undefined
              ? "never"
              : "fresh",
        completeness: githubCompleteness,
        lastSucceededAt: githubLastSucceededAt ?? null,
      },
      {
        sourceSystem: "codex_local",
        status: codexCoverage === undefined ? "not_configured" : "connected",
        freshness: codexCoverage?.freshness ?? "never",
        completeness: codexCoverage?.completeness ?? "unavailable",
        lastSucceededAt: codexCoverage?.lastSucceededAt ?? null,
      },
      {
        sourceSystem: "codex_account",
        status: codexAccountCoverage === undefined ? "not_configured" : "connected",
        freshness: codexAccountCoverage?.freshness ?? "never",
        completeness: codexAccountCoverage?.completeness ?? "unavailable",
        lastSucceededAt: codexAccountCoverage?.lastSucceededAt ?? null,
      },
      {
        sourceSystem: "openai_usage",
        status: "not_configured",
        freshness: "never",
        completeness: "unavailable",
        lastSucceededAt: null,
      },
    ],
  };
}
