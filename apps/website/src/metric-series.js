export const metricDefinitions = Object.freeze({
  projects: { label: "Projects" },
  commits: { label: "Commits" },
  pushes: { label: "Pushes" },
  tokens: { label: "Observed tokens", monthlyOnly: true },
  agents: { label: "Agents" },
  subagents: { label: "Subagents" },
});

const dayMilliseconds = 86_400_000;
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const iso = (date) => date.toISOString().slice(0, 10);
const instant = (date) => new Date(`${date}T00:00:00Z`);
const observed = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

function validateDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+instant(value)) || iso(instant(value)) !== value) {
    throw new RangeError("Expected a calendar date in YYYY-MM-DD format");
  }
}

/** Inclusive calendar-day window, independent of month length and DST. */
export function rollingDateRange(end, dayCount = 30) {
  validateDate(end);
  if (!Number.isInteger(dayCount) || dayCount < 1) throw new RangeError("Expected a positive day count");
  return { start: iso(new Date(+instant(end) - (dayCount - 1) * dayMilliseconds)), end };
}

function bucketKey(date, group) {
  if (group === "month") return `${date.slice(0, 7)}-01`;
  if (group === "week") {
    const monday = instant(date);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return iso(monday);
  }
  return date;
}

function labelFor(date, endDate, group) {
  if (group === "month") return monthFormat.format(instant(date));
  if (date === endDate) return dayFormat.format(instant(date));
  return `${dayFormat.format(instant(date))} – ${dayFormat.format(instant(endDate))}`;
}

/** Aggregate the published observations, retaining gaps instead of inventing zeroes. */
export function buildMetricSeries({ months = [], days = [] }, metric, { start, end, group = "day" }) {
  if (!Object.hasOwn(metricDefinitions, metric)) throw new RangeError("Unknown metric");
  if (!["day", "week", "month"].includes(group)) throw new RangeError("Unknown grouping");
  if (metric === "tokens" && group !== "month") throw new RangeError("Token observations are monthly only");
  validateDate(start);
  validateDate(end);
  if (start > end) return [];

  if (metric === "tokens") {
    const byMonth = new Map(months.map((month) => [month.month, month.tokens]));
    const cursor = instant(`${start.slice(0, 7)}-01`);
    const result = [];
    while (iso(cursor) <= end) {
      const first = iso(cursor);
      const month = first.slice(0, 7);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      const last = iso(new Date(+cursor - dayMilliseconds));
      // Monthly counters retain their full source interval even when the view
      // starts mid-month; they cannot be prorated into a daily subtotal.
      const date = first;
      const endDate = last > end ? end : last;
      const value = byMonth.get(month);
      // A current month's published observation remains a monthly observation.
      result.push({ date, endDate, label: monthFormat.format(instant(first)), value: observed(value) ? value : null, partial: false });
    }
    return result;
  }

  const byDate = new Map(days.map((day) => [day.date, day]));
  const projectsByDate = new Map();
  if (metric === "projects") {
    for (const month of months) {
      for (const project of month.projects ?? []) {
        for (const event of project.activity ?? []) {
          if (event.kind !== "commit" && event.kind !== "push") continue;
          const names = projectsByDate.get(event.date) ?? new Set();
          names.add(project.name);
          projectsByDate.set(event.date, names);
        }
      }
    }
  }

  const buckets = new Map();
  for (let time = +instant(start); time <= +instant(end); time += dayMilliseconds) {
    const date = iso(new Date(time));
    const key = bucketKey(date, group);
    const bucket = buckets.get(key) ?? { date, endDate: date, values: [], projects: new Set(), partial: false };
    const source = byDate.get(date);
    bucket.partial ||= source?.partialMetrics?.includes(metric) ?? false;
    bucket.endDate = date;
    if (metric === "projects") {
      const names = projectsByDate.get(date) ?? new Set();
      names.forEach((name) => bucket.projects.add(name));
      const commitsKnown = observed(source?.commits);
      const pushesKnown = observed(source?.pushes);
      bucket.values.push(names.size || (commitsKnown || pushesKnown ? 0 : null));
      bucket.partial ||= (commitsKnown || pushesKnown || names.size > 0) && (!commitsKnown || !pushesKnown);
    } else {
      const value = source?.[metric];
      bucket.values.push(observed(value) ? value : null);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()].map(({ date, endDate, values, projects, partial }) => {
    const known = values.filter((value) => value !== null);
    const value = !known.length ? null : metric === "projects" ? projects.size : known.reduce((sum, item) => sum + item, 0);
    return {
      date, endDate, label: labelFor(date, endDate, group), value,
      partial: value !== null && (partial || known.length < values.length),
      ...(metric === "projects" ? { projects: [...projects].sort() } : {}),
    };
  });
}

export function metricSummary(points, metric) {
  if (!Object.hasOwn(metricDefinitions, metric)) throw new RangeError("Unknown metric");
  const known = points.filter((point) => observed(point.value));
  const total = !known.length ? null : metric === "projects"
    ? new Set(known.flatMap((point) => point.projects ?? [])).size
    : known.reduce((sum, point) => sum + point.value, 0);
  return {
    total,
    average: known.length ? known.reduce((sum, point) => sum + point.value, 0) / known.length : null,
    peak: known.reduce((peak, point) => !peak || point.value > peak.value ? point : peak, null),
    available: known.length,
    missing: points.length - known.length,
    partial: known.filter((point) => point.partial).length,
  };
}

/** Exports only the selected aggregate, never project names or event subjects. */
export function seriesCsv(points, metric, window) {
  if (!Object.hasOwn(metricDefinitions, metric)) throw new RangeError("Unknown metric");
  if (window) {
    const validInstants = [window.startAt, window.endAt].every((value) => typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
    if (!validInstants || Date.parse(window.endAt) - Date.parse(window.startAt) !== dayMilliseconds) {
      throw new RangeError("Expected an exact 24-hour UTC window");
    }
  }
  const prefix = window ? `${window.startAt},${window.endAt},` : "";
  return [
    `${window ? "window_start,window_end," : ""}date,end_date,${metric},quality`,
    ...points.map((point) => `${prefix}${point.date},${point.endDate},${point.value ?? ""},${point.value === null ? "unavailable" : point.partial ? "partial" : "available"}`),
  ].join("\r\n") + "\r\n";
}
