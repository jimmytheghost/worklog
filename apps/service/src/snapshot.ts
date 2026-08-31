import { localDateForInstant, utcRangeForLocalDate, type MetricResult } from "@agent-dashboard/domain";
import type { Storage } from "@agent-dashboard/storage";

import { GITHUB_SOURCE_ID } from "./github-sync.js";

type SnapshotStorage = Pick<
  Storage,
  "getCoverage" | "listProjects" | "listRecentEvents" | "queryDailyGitActivity"
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
  event: ReturnType<SnapshotStorage["listRecentEvents"]>[number],
  projectName: string,
): string {
  switch (event.eventType) {
    case "git.commit.discovered":
      return `Commit discovered in ${projectName}`;
    case "github.push.observed":
      return `Push observed on ${projectName}/${event.payload.ref.replace("refs/heads/", "")}`;
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
  const hasGitHubData = commitCoverage !== undefined || pushCoverage !== undefined;
  const activity = hasGitHubData
    ? storage.queryDailyGitActivity({
        startLocalDate,
        endLocalDateExclusive,
        timeZone: options.timeZone,
      })
    : [];
  const commitCount = hasGitHubData
    ? activity.reduce((total, day) => total + day.commits, 0)
    : null;
  const pushCount = hasGitHubData
    ? activity.reduce((total, day) => total + day.pushes, 0)
    : null;
  const activeDays = hasGitHubData
    ? activity.filter((day) => day.commits > 0 || day.pushes > 0).length
    : null;

  const metric = (
    name: string,
    value: number | null,
    sourceSystems: MetricResult["sourceSystems"],
    coverage: typeof commitCoverage,
  ): MetricResult => ({
    metric: name,
    value,
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

  const recentEvents = storage.listRecentEvents(100);
  const projects = storage.listProjects();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const latestProjectEvents = new Map<string, string>();
  for (const event of recentEvents) {
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
        status: commits > 0 ? "active" : "quiet",
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
    summary: [
      metric("commits", commitCount, ["github"], commitCoverage),
      metric("pushes", pushCount, ["github"], pushCoverage),
      metric("active_days", activeDays, ["github"], commitCoverage),
      {
        metric: "codex_observed_tokens",
        value: null,
        unit: "tokens",
        interval: range,
        dimensions: { usageNamespace: "codex_local" },
        sourceSystems: ["codex_local"],
        completeness: "unavailable",
        freshness: "never",
      } satisfies MetricResult,
    ],
    activityDays: activity.map((day) => ({
      date: day.localDate,
      commits: day.commits,
      pushes: day.pushes,
      codexAttributedCommits: 0,
    })),
    projects: projectRows,
    agents: [],
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
        status: "not_configured",
        freshness: "never",
        completeness: "unavailable",
        lastSucceededAt: null,
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
