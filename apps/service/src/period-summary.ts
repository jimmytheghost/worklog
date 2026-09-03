import {
  localDateForInstant,
  utcRangeForLocalDate,
  type EventPayloads,
} from "@agent-dashboard/domain";
import type { Storage } from "@agent-dashboard/storage";

export const PERIODS = ["day", "week", "month", "year", "all"] as const;
export type SummaryPeriod = (typeof PERIODS)[number];

type PeriodStorage = Pick<
  Storage,
  "listGitActivityEvents" | "listProjects" | "queryCodexObservedTokens" | "queryDailyGitActivity"
>;

function shiftLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function startForPeriod(period: SummaryPeriod, today: string): string {
  if (period === "all") return "1970-01-01";
  if (period === "year") return `${today.slice(0, 4)}-01-01`;
  if (period === "month") return shiftLocalDate(today, -29);
  if (period === "week") return shiftLocalDate(today, -6);
  return today;
}

export function boundsForPeriod(period: SummaryPeriod, timeZone: string, now = new Date()) {
  const today = localDateForInstant(now, timeZone);
  const startLocalDate = startForPeriod(period, today);
  const endLocalDateExclusive = shiftLocalDate(today, 1);
  return {
    startLocalDate,
    endLocalDateExclusive,
    start: utcRangeForLocalDate(startLocalDate, timeZone).start,
    end: utcRangeForLocalDate(endLocalDateExclusive, timeZone).start,
  };
}

export function buildPeriodSummary(
  storage: PeriodStorage,
  options: { period: SummaryPeriod; timeZone: string; now?: Date },
) {
  const bounds = boundsForPeriod(options.period, options.timeZone, options.now);
  const range = { start: bounds.start, end: bounds.end };
  const events = storage.listGitActivityEvents(range);
  const projectNames = new Map(storage.listProjects().map((project) => [project.id, project.name]));
  const tokenUsage = storage.queryCodexObservedTokens(range);
  const activityDays = storage.queryDailyGitActivity({
    startLocalDate: bounds.startLocalDate,
    endLocalDateExclusive: bounds.endLocalDateExclusive,
    timeZone: options.timeZone,
  });

  return {
    schemaVersion: 1,
    period: options.period,
    timezone: options.timeZone,
    range,
    metrics: {
      tokens: tokenUsage.knowledge === "unknown" ? null : tokenUsage.knownSubtotal,
      commits: events.filter((event) => event.eventType === "git.commit.discovered").length,
      pushes: events.filter((event) => event.eventType === "github.push.observed").length,
      activeDays: activityDays.filter((day) => day.commits > 0 || day.pushes > 0).length,
      projects: new Set(events.flatMap((event) => event.repositoryId ?? [])).size,
    },
    recentActivity: events.slice(0, 5).map((event) => {
      if (event.eventType === "git.commit.discovered") {
        const payload = event.payload as EventPayloads["git.commit.discovered"];
        return {
          eventId: event.eventId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          summary: payload.subject ?? `Commit ${payload.sha.slice(0, 7)}`,
        };
      }
      const payload = event.payload as EventPayloads["github.push.observed"];
      const projectName = event.repositoryId === undefined
        ? "unknown project"
        : (projectNames.get(event.repositoryId) ?? "unknown project");
      return {
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        summary: `Push observed on ${projectName}/${payload.ref.replace(/^refs\/heads\//, "")}`,
      };
    }),
  };
}
