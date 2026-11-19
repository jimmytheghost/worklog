const dayMilliseconds = 86_400_000;
const quarterHour = 15 * 60_000;
const freshness = 35 * 60_000;
const metrics = ["projects", "commits", "pushes", "agents", "subagents", "tokens"];
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const sumKnown = (values) => {
  const known = values.filter(count);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const result = Date.parse(value);
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 19) === value.slice(0, 19) ? result : NaN;
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
function dateFormatter(timeZone) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
}
function localDate(formatter, value) {
  const parts = formatter.formatToParts(new Date(value));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type).value).join("-");
}
function windowsFor(source) {
  const generated = instant(source.feed.generatedAt);
  const windows = new Map();
  for (const window of Array.isArray(source.feed.rolling24Hours) ? source.feed.rolling24Hours : []) {
    const start = instant(window?.start), end = instant(window?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== dayMilliseconds
      || end % quarterHour !== 0 || !Number.isFinite(generated) || end > generated || generated - end >= 60 * 60_000) continue;
    const key = `${start}/${end}`;
    // Duplicate window entries are ambiguous; retain no observation for that key.
    if (windows.has(key)) windows.set(key, null);
    else windows.set(key, window);
  }
  return new Map([...windows].filter(([, window]) => window));
}

/** Select one shared half-open 24-hour interval; never infer instants from date-only rows. */
export function selectToday(monthsMerged, primaryFeed, devices = [], timeZone = "UTC") {
  const formatter = dateFormatter(timeZone);
  const sources = [{ id: "primary", feed: primaryFeed ?? {}, git: primaryFeed?.coverage ?? {}, months: primaryFeed?.months ?? [] },
    ...devices.map(([id, feed]) => ({ id, feed, git: feed.git ?? {}, months: feed.git?.months ?? [] }))];
  const reports = sources.map((source) => instant(source.feed.generatedAt)).filter(Number.isFinite);
  const latest = reports.length ? Math.max(...reports) : Date.now();
  const reportedAt = reports.length ? new Date(latest).toISOString() : null;
  for (const source of sources) source.windows = windowsFor(source);
  const eligible = sources.filter((source) => Number.isFinite(instant(source.feed.generatedAt))
    && latest - instant(source.feed.generatedAt) <= freshness && source.windows.size);
  const common = eligible.length ? [...eligible[0].windows.keys()].filter((key) => eligible.every((source) => source.windows.has(key))) : [];
  common.sort((left, right) => Number(right.split("/")[1]) - Number(left.split("/")[1]));
  const selected = common[0];
  const endAt = selected ? Number(selected.split("/")[1]) : Math.floor(latest / quarterHour) * quarterHour;
  const startAt = endAt - dayMilliseconds;
  const bounds = { start: localDate(formatter, startAt), end: localDate(formatter, endAt - 1),
    startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), mode: "today" };
  const dates = [];
  const shortDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  for (const cursor = new Date(`${bounds.start}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= bounds.end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    dates.push({ date, label: shortDate.format(cursor), tick: shortDate.format(cursor) });
  }
  if (!selected) return {
    bounds, months: [], days: dates.map((day) => ({ ...day, commits: null, pushes: null, agents: null, subagents: null, partialMetrics: [...metrics] })),
    totals: { commits: null, pushes: null, agents: null, subagents: null }, tokens: null, tokensKnowledge: "unknown",
    projectCount: null, partialMetrics: [...metrics], missingDevices: sources.map(({ id }) => id), reportedAt,
    reason: eligible.length ? "No shared last-24-hours reporting window is available." : "Last-24-hours reports are unavailable.",
  };
  const missingDevices = sources.filter((source) => !eligible.includes(source)).map(({ id }) => id);
  const partial = new Set();
  if (missingDevices.length) ["agents", "subagents", "tokens"].forEach((key) => partial.add(key));
  const chosen = eligible.map((source) => ({ ...source, window: source.windows.get(selected) }));
  const hasDailyCounters = ({ feed }) => feed.months?.some((month) => Array.isArray(month.tokenDays));
  const dailyCounters = sources.some(hasDailyCounters);
  const tokenSources = dailyCounters ? chosen.filter(hasDailyCounters) : chosen;
  const tokens = sumKnown(tokenSources.map(({ window }) => ["complete", "partial"].includes(window.tokensKnowledge) ? window.tokens : null));
  const tokensKnowledge = tokens === null ? "unknown" : missingDevices.length || tokenSources.length !== chosen.length || tokenSources.some(({ window }) => !count(window.tokens) || window.tokensKnowledge !== "complete") ? "partial" : "complete";
  if (tokensKnowledge !== "complete") partial.add("tokens");
  const totals = {};
  for (const key of ["agents", "subagents"]) {
    totals[key] = sumKnown(chosen.map(({ window }) => window[key]));
    if (chosen.some(({ window }) => !count(window[key]))) partial.add(key);
  }
  const knownGit = {};
  for (const key of ["commits", "pushes"]) {
    const reports = sources.map(({ git }) => instant(git[`${key}At`]));
    knownGit[key] = reports.some(Number.isFinite);
    if (reports.some((at) => !Number.isFinite(at) || at < endAt - freshness)) partial.add(key);
    totals[key] = knownGit[key] ? 0 : null;
  }
  const dayMap = new Map(dates.map((day) => [day.date, { ...day,
    commits: knownGit.commits ? 0 : null, pushes: knownGit.pushes ? 0 : null, agents: null, subagents: null,
  }]));
  for (const key of ["agents", "subagents"]) {
    for (const day of dayMap.values()) {
      const values = [];
      for (const { window } of chosen) {
        if (!count(window[key])) { values.push(null); continue; }
        const rows = Array.isArray(window.agentDays) ? window.agentDays : [];
        const valid = rows.filter((row) => validDate(row?.localDate) && dayMap.has(row.localDate) && count(row[key]));
        const duplicates = new Set(valid.map((row) => row.localDate)).size !== valid.length;
        const consistent = !duplicates && valid.length === rows.length && valid.reduce((sum, row) => sum + row[key], 0) === window[key];
        if (!consistent) { values.push(null); partial.add(key); continue; }
        values.push(valid.find((row) => row.localDate === day.date)?.[key] ?? 0);
      }
      day[key] = sumKnown(values);
    }
  }
  const grouped = new Map();
  for (const month of monthsMerged) {
    for (const project of month.projects ?? []) {
      for (const row of project.activity ?? []) {
        if (!["commit", "push"].includes(row.kind)) continue;
        const key = row.kind === "commit" ? "commits" : "pushes";
        const at = instant(row.occurredAt);
        if (!Number.isFinite(at)) {
          if (!validDate(row.date) || row.date >= bounds.start && row.date <= bounds.end) partial.add(key);
          continue;
        }
        if (at < startAt || at >= endAt) continue;
        const date = localDate(formatter, at);
        const day = dayMap.get(date);
        if (!day) continue;
        day[key] = (day[key] ?? 0) + 1;
        totals[key] = (totals[key] ?? 0) + 1;
        const monthKey = date.slice(0, 7);
        const monthProjects = grouped.get(monthKey) ?? new Map();
        const selectedProject = monthProjects.get(project.name) ?? { ...project, commits: 0, pushes: 0, activity: [] };
        selectedProject[key]++;
        selectedProject.activity.push({ ...row, date });
        monthProjects.set(project.name, selectedProject);
        grouped.set(monthKey, monthProjects);
      }
    }
  }
  if (partial.has("commits") || partial.has("pushes")) partial.add("projects");
  const projectCount = grouped.size ? new Set([...grouped.values()].flatMap((projects) => [...projects.keys()])).size
    : knownGit.commits || knownGit.pushes ? 0 : null;
  const partialMetrics = metrics.filter((metric) => partial.has(metric));
  const days = [...dayMap.values()].map((day) => ({ ...day, partialMetrics: [...partialMetrics] }));
  const months = [...grouped].sort(([left], [right]) => right.localeCompare(left)).map(([month, projects]) => ({
    month, tokens: null, agentDays: days.filter(({ date }) => date.startsWith(month)).map(({ date, agents, subagents }) => ({ localDate: date, agents, subagents })),
    projects: [...projects.values()],
  }));
  return { bounds, months, days, totals, tokens, tokensKnowledge, dailyCounters, projectCount, partialMetrics, missingDevices, reportedAt };
}
