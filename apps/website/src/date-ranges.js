const utc = (date) => new Date(`${date}T00:00:00Z`);
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const iso = (date) => date.toISOString().slice(0, 10);
const keys = ["commits", "pushes", "agents", "subagents"];
const sum = (values) => {
  const known = values.filter((value) => value != null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};

export function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(+utc(value)) && iso(utc(value)) === value;
}

export function resolveRange(preset, earliest, latest, start, end) {
  if (!validDate(earliest) || !validDate(latest)) throw new RangeError("Invalid reporting dates");
  if (preset === "custom") {
    if (!validDate(start) || !validDate(end)) throw new RangeError("Choose both a start and end date.");
    if (start > end) throw new RangeError("Start date must be on or before end date.");
    if (start < earliest || end > latest) throw new RangeError(`Choose dates from ${earliest} through ${latest}.`);
    return { start, end };
  }
  end = latest;
  if (preset === "today") start = latest;
  else if (preset === "all") start = earliest;
  else if (preset === "year") start = `${latest.slice(0, 4)}-01-01`;
  else if (["7", "30", "90"].includes(preset)) {
    const date = utc(latest);
    date.setUTCDate(date.getUTCDate() - Number(preset) + 1);
    start = iso(date);
  } else if (/^\d{4}-\d{2}$/.test(preset) && validDate(`${preset}-01`)) {
    start = `${preset}-01`;
    const date = utc(start);
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    end = iso(date) < latest ? iso(date) : latest;
  } else throw new RangeError("Unknown date range");
  if (start > end || end < earliest) throw new RangeError("Date range is outside recorded history");
  return { start: start < earliest ? earliest : start, end };
}

/** Windows is an expected recording device, including when its feed is unavailable. */
export function tokenDaySources(primaryMonths, devices, available = true) {
  const sources = [primaryMonths, ...devices.map(([, device]) => device.months ?? [])];
  if (!available || !devices.some(([id]) => id === "windows-pc")) sources.push([]);
  return sources;
}

/** Each device contributes at most one observed subtotal per reporting date. */
export function mergeTokenDays(sources) {
  if (!sources.some((months) => months.some((month) => Array.isArray(month.tokenDays)))) return null;
  const byDate = new Map();
  for (const months of sources) {
    const rows = new Map();
    for (const month of months) {
      for (const day of month.tokenDays ?? []) {
        if (validDate(day.localDate) && day.localDate.startsWith(month.month + "-")) {
          rows.set(day.localDate, rows.has(day.localDate) ? null : day);
        }
      }
    }
    for (const [date, row] of rows) {
      const summary = byDate.get(date) ?? { tokens: null, completeDevices: 0 };
      if (Number.isSafeInteger(row?.tokens) && row.tokens >= 0 && ["complete", "partial"].includes(row.tokensKnowledge)) {
        summary.tokens = (summary.tokens ?? 0) + row.tokens;
        if (row.tokensKnowledge === "complete") summary.completeDevices++;
      }
      byDate.set(date, summary);
    }
  }
  return new Map([...byDate].map(([date, row]) => [date, {
    tokens: row.tokens, tokensKnowledge: row.tokens === null ? "unknown"
      : row.completeDevices === sources.length ? "complete" : "partial",
  }]));
}

/** Filter event records before counting projects; never prorate monthly token observations. */
export function selectRange(months, days, { start, end }, latest) {
  const selectedMonths = months.filter(({ month }) => month >= start.slice(0, 7) && month <= end.slice(0, 7));
  const filtered = selectedMonths.map((month) => ({ ...month, projects: month.projects.flatMap((project) => {
    const activity = project.activity.filter((event) => event.date >= start && event.date <= end);
    return activity.length ? [{ ...project, activity,
      commits: activity.filter((event) => event.kind === "commit").length,
      pushes: activity.filter((event) => event.kind === "push").length,
    }] : [];
  }) }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  const selectedDays = [];
  for (const cursor = utc(start); iso(cursor) <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = iso(cursor);
    selectedDays.push(byDate.get(date) ?? { date, label: dayFormat.format(cursor),
      tick: cursor.getUTCDate() === 1 || cursor.getUTCDate() % 5 === 0 ? String(cursor.getUTCDate()) : "",
      commits: null, pushes: null, agents: null, subagents: null });
  }
  const last = utc(`${end.slice(0, 7)}-01`);
  last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  const coversMonths = start.endsWith("-01") && (end === iso(last) || end === latest);
  const daily = days.some((day) => Object.hasOwn(day, "tokensKnowledge"));
  const tokens = daily ? sum(selectedDays.map((day) => day.tokens)) : coversMonths ? sum(selectedMonths.map(({ tokens }) => tokens)) : null;
  const totals = Object.fromEntries(keys.map((key) => [key, sum(selectedDays.map((day) => day[key]))]));
  const partialMetrics = daily && tokens !== null && selectedDays.some((day) => day.tokensKnowledge !== "complete") ? ["tokens"] : [];
  return { months: filtered, days: selectedDays, totals, tokens, coversMonths, dailyTokens: daily, partialMetrics };
}
