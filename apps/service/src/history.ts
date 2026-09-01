import { utcRangeForLocalDate, type EventPayloads } from "@agent-dashboard/domain";
import type { Storage } from "@agent-dashboard/storage";

type HistoryStorage = Pick<
  Storage,
  "listProjects" | "listGitActivityEvents" | "queryCodexObservedTokens"
>;

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function monthBounds(month: string, timeZone: string) {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) throw new RangeError("month must use YYYY-MM");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new RangeError("month must use YYYY-MM");
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const startLocalDate = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const endLocalDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return {
    start: utcRangeForLocalDate(startLocalDate, timeZone).start,
    end: utcRangeForLocalDate(endLocalDate, timeZone).start,
  };
}

function refName(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

export function buildMonthlyHistory(
  storage: HistoryStorage,
  options: { month: string; timeZone: string },
) {
  const range = monthBounds(options.month, options.timeZone);
  const projects = storage.listProjects();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const events = storage.listGitActivityEvents(range);
  const grouped = new Map<string, typeof events>();

  for (const event of events) {
    if (event.repositoryId === undefined || !projectById.has(event.repositoryId)) continue;
    const projectEvents = grouped.get(event.repositoryId) ?? [];
    projectEvents.push(event);
    grouped.set(event.repositoryId, projectEvents);
  }

  const projectRows = [...grouped].map(([projectId, projectEvents]) => {
    const project = projectById.get(projectId)!;
    const commits = projectEvents.filter((event) => event.eventType === "git.commit.discovered").length;
    const pushes = projectEvents.filter((event) => event.eventType === "github.push.observed").length;
    return {
      projectId,
      name: project.name,
      owner: project.owner,
      branch: project.defaultBranch ?? "unknown",
      commits,
      pushes,
      tokens: (() => {
        const usage = storage.queryCodexObservedTokens({ ...range, repositoryIds: [projectId] });
        return usage.sessionsObserved === 0 || usage.knowledge === "unknown" ? null : usage.knownSubtotal;
      })(),
      lastActivityAt: projectEvents[0]!.occurredAt,
      activity: projectEvents.map((event) => {
        if (event.eventType === "git.commit.discovered") {
          const payload = event.payload as EventPayloads["git.commit.discovered"];
          return {
            id: event.eventId,
            type: "commit" as const,
            occurredAt: event.occurredAt,
            subject: payload.subject ?? `Commit ${payload.sha.slice(0, 7)}`,
            detail: payload.sha.slice(0, 7),
            url: payload.url ?? null,
            source: event.sourceSystem,
            attribution: event.attribution,
            confidence: event.confidence,
          };
        }
        const payload = event.payload as EventPayloads["github.push.observed"];
        const branch = refName(payload.ref);
        const kind = payload.activityKind ?? (payload.forced ? "force_push" : "push");
        return {
          id: event.eventId,
          type: "push" as const,
          occurredAt: event.occurredAt,
          subject: `${kind === "force_push" ? "Force push" : kind === "branch_creation" ? "Branch created" : kind === "branch_deletion" ? "Branch deleted" : "Push"} · ${branch}`,
          detail: payload.commitShas.length === 0
            ? branch
            : `${payload.commitShas.length} commit${payload.commitShas.length === 1 ? "" : "s"}`,
          url: null,
          source: event.sourceSystem,
          attribution: event.attribution,
          confidence: event.confidence,
        };
      }),
    };
  }).sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt) || left.name.localeCompare(right.name),
  );

  const tokenUsage = storage.queryCodexObservedTokens(range);
  return {
    schemaVersion: 1,
    month: options.month,
    timezone: options.timeZone,
    range,
    summary: {
      projects: projectRows.length,
      commits: projectRows.reduce((sum, project) => sum + project.commits, 0),
      pushes: projectRows.reduce((sum, project) => sum + project.pushes, 0),
      tokens: tokenUsage.knowledge === "unknown" ? null : tokenUsage.knownSubtotal,
    },
    projects: projectRows,
    sources: [
      { source: "github", completeness: "partial" },
      { source: "codex_local", completeness: tokenUsage.knowledge },
    ],
  };
}
