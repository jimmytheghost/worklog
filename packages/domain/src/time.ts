import { deduplicateEvents } from "./idempotency.js";
import type { AnyNormalizedEvent, DailyCount, EventType } from "./types.js";

export const DEFAULT_TIME_ZONE = "America/Denver";

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;

  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

function partsAt(instant: Date, timeZone: string): CalendarParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseLocalDate(localDate: string): Pick<CalendarParts, "year" | "month" | "day"> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null) throw new RangeError(`Invalid local date: ${localDate}`);
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid local date: ${localDate}`);
  }
  return { year, month, day };
}

function nextLocalDate(localDate: string): string {
  const { year, month, day } = parseLocalDate(localDate);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Returns the local calendar date for an exact instant in an IANA timezone. */
export function localDateForInstant(
  instant: string | number | Date,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: ${String(instant)}`);
  const { year, month, day } = partsAt(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Resolves local midnight to UTC by iterating the timezone's observed offset.
 * Midnight is unambiguous for America/Denver, including DST transition days.
 */
function localMidnightToUtc(localDate: string, timeZone: string): Date {
  const target = { ...parseLocalDate(localDate), hour: 0, minute: 0, second: 0 };
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day);
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = partsAt(new Date(candidate), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = targetAsUtc - actualAsUtc;
    candidate += correction;
    if (correction === 0) return new Date(candidate);
  }

  const resolved = new Date(candidate);
  const actual = partsAt(resolved, timeZone);
  if (
    actual.year !== target.year ||
    actual.month !== target.month ||
    actual.day !== target.day ||
    actual.hour !== 0 ||
    actual.minute !== 0 ||
    actual.second !== 0
  ) {
    throw new RangeError(`Local midnight ${localDate} does not resolve in ${timeZone}`);
  }
  return resolved;
}

export interface UtcDayRange {
  localDate: string;
  timeZone: string;
  start: string;
  end: string;
  durationMilliseconds: number;
}

/** Produces the half-open UTC range [local midnight, next local midnight). */
export function utcRangeForLocalDate(
  localDate: string,
  timeZone = DEFAULT_TIME_ZONE,
): UtcDayRange {
  const start = localMidnightToUtc(localDate, timeZone);
  const end = localMidnightToUtc(nextLocalDate(localDate), timeZone);
  return {
    localDate,
    timeZone,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMilliseconds: end.getTime() - start.getTime(),
  };
}

export interface AggregateEventsOptions {
  timeZone?: string;
  eventTypes?: readonly EventType[];
}

/** Deduplicates semantic events, then counts them by local calendar day. */
export function aggregateEventsByLocalDay(
  events: readonly AnyNormalizedEvent[],
  options: AggregateEventsOptions = {},
): DailyCount[] {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const eventTypes = options.eventTypes === undefined ? undefined : new Set(options.eventTypes);
  const counts = new Map<string, number>();

  for (const event of deduplicateEvents(events)) {
    if (eventTypes !== undefined && !eventTypes.has(event.eventType)) continue;
    const localDate = localDateForInstant(event.occurredAt, timeZone);
    counts.set(localDate, (counts.get(localDate) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([localDate, count]) => ({ localDate, count }));
}
