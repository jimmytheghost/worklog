import { localDateForInstant, type EventPayloads } from "@agent-dashboard/domain";
import type { CodexTokenKnowledge, Storage } from "@agent-dashboard/storage";

import { buildAgentActivity } from "./agent-activity.js";
import { CODEX_COVERAGE_KEY } from "./codex-sync.js";
import { GITHUB_SOURCE_ID } from "./github-sync.js";
import { monthBounds } from "./history.js";
import { boundsForPeriod } from "./period-summary.js";

interface PublicProject {
  name: string;
  commits: number;
  pushes: number;
  activity: Array<{ date: string; occurredAt: string; kind: "commit" | "push"; subject: string; url?: string }>;
}

/** Aligned snapshots let separately scheduled devices share an exact 24-hour window. */
function rolling24Hours(storage: Storage, timeZone: string, now: Date) {
  const quarterHour = 15 * 60 * 1_000;
  const latestEnd = Math.floor(now.getTime() / quarterHour) * quarterHour;
  const coverage = storage.getCoverage(CODEX_COVERAGE_KEY, now);
  return Array.from({ length: 4 }, (_, offset) => {
    const end = new Date(latestEnd - offset * quarterHour).toISOString();
    const start = new Date(Date.parse(end) - 24 * 60 * 60 * 1_000).toISOString();
    const usage = storage.queryCodexObservedTokens({ start, end });
    const hasReport = coverage?.lastSucceededAt !== undefined
      && Date.parse(coverage.lastSucceededAt) >= Date.parse(start);
    const observedZero = usage.sessionsObserved === 0 && hasReport;
    const tokens = usage.sessionsKnown > 0 || observedZero ? usage.knownSubtotal : null;
    const tokensKnowledge: CodexTokenKnowledge = tokens === null ? "unknown"
      : observedZero && (coverage?.completeness !== "complete"
        || Date.parse(coverage.coverageEnd ?? coverage.lastSucceededAt ?? "") < Date.parse(end))
        ? "partial" : usage.knowledge;
    const agents = buildAgentActivity(storage, { start, end }, timeZone, now);
    return { start, end, tokens, tokensKnowledge, agents: agents.agents,
      subagents: agents.subagents, agentDays: agents.days };
  });
}

export function buildPublicActivity(storage: Storage, timeZone: string, now: Date) {
  const range = boundsForPeriod("all", timeZone, now);
  const currentMonth = localDateForInstant(now, timeZone).slice(0, 7);
  const { days, coverage: agentCoverage } = buildAgentActivity(storage, range, timeZone, now);
  const commits = storage.getCoverage(`${GITHUB_SOURCE_ID}:commits`, now);
  const pushes = storage.getCoverage(`${GITHUB_SOURCE_ID}:pushes`, now);
  const projects = new Map(storage.listProjects().map((project) => [
    project.id, project.owner ? `${project.owner}/${project.name}` : project.name,
  ]));
  const byMonth = new Map<string, Map<string, PublicProject>>();

  for (const event of storage.listGitActivityEvents(range)) {
    const name = projects.get(event.repositoryId ?? "");
    if (name === undefined) continue;
    const date = localDateForInstant(event.occurredAt, timeZone);
    const month = date.slice(0, 7);
    const monthProjects = byMonth.get(month) ?? new Map<string, PublicProject>();
    const project = monthProjects.get(name) ?? { name, commits: 0, pushes: 0, activity: [] };
    if (event.eventType === "git.commit.discovered") {
      const payload = event.payload as EventPayloads["git.commit.discovered"];
      const url = /^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(name)
        ? `https://github.com/${name}/commit/${payload.sha}`
        : undefined;
      project.commits += 1;
      project.activity.push({
        date, occurredAt: event.occurredAt, kind: "commit", subject: payload.subject ?? "Commit",
        ...(url === undefined ? {} : { url }),
      });
    } else {
      project.pushes += 1;
      project.activity.push({ date, occurredAt: event.occurredAt, kind: "push", subject: "Push observed" });
    }
    monthProjects.set(name, project);
    byMonth.set(month, monthProjects);
  }

  const agentDaysByMonth = new Map<string, typeof days>();
  for (const day of days) {
    const month = day.localDate.slice(0, 7);
    const monthlyDays = agentDaysByMonth.get(month) ?? [];
    monthlyDays.push(day);
    agentDaysByMonth.set(month, monthlyDays);
  }

  const firstMonth = [currentMonth, ...byMonth.keys(), ...agentDaysByMonth.keys()].sort()[0]!;
  const months: string[] = [];
  const cursor = new Date(`${firstMonth}-01T00:00:00.000Z`);
  for (let month = firstMonth; month <= currentMonth; month = cursor.toISOString().slice(0, 7)) {
    months.push(month);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    timeZone,
    rolling24Hours: rolling24Hours(storage, timeZone, now),
    coverage: {
      commitsAt: commits?.lastSucceededAt ?? null,
      pushesAt: pushes?.lastSucceededAt ?? null,
      agentsAt: agentCoverage?.lastSucceededAt ?? null,
      agentsFrom: agentCoverage?.coverageStart
        ? localDateForInstant(agentCoverage.coverageStart, timeZone)
        : null,
    },
    months: months.reverse().map((month) => {
      const agentDays = agentDaysByMonth.get(month) ?? [];
      const bounds = monthBounds(month, timeZone);
      const observedTokens = storage.queryCodexObservedTokens(bounds);
      return {
        month,
        tokens: observedTokens.sessionsKnown === 0 ? null : observedTokens.knownSubtotal,
        agentDays,
        projects: [...(byMonth.get(month)?.values() ?? [])].sort((left, right) =>
          right.commits - left.commits || right.pushes - left.pushes || left.name.localeCompare(right.name),
        ),
      };
    }),
  };
}
