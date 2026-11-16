const status = document.querySelector("#status");
const dashboard = document.querySelector("#dashboard");
const updated = document.querySelector("#updated");
const sourceUpdates = document.querySelector("#source-updates");
const period = document.querySelector("#period");
const chartMetric = document.querySelector("#chart-metric");
const chart = document.querySelector("#chart");
const chartDetail = document.querySelector("#chart-detail");
const search = document.querySelector("#search");
const projectsContainer = document.querySelector("#projects");
const projectCount = document.querySelector("#project-count");
const metrics = document.querySelector("#metrics");
const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const chartLabels = { commits: "Commits", pushes: "Pushes", agents: "Agents", subagents: "Subagents" };

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function monthLabel(month) {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

function dayLabel(day) {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

function valueLabel(value) {
  return value === null ? "—" : number.format(value);
}

function sumObserved(values) {
  const measured = values.filter((value) => value !== null);
  return measured.length ? measured.reduce((total, value) => total + value, 0) : null;
}

function combineProjects(months) {
  const projects = new Map();
  for (const month of months) {
    for (const project of month.projects) {
      const combined = projects.get(project.name) ?? { name: project.name, commits: 0, pushes: 0, activity: [] };
      combined.commits += project.commits;
      combined.pushes += project.pushes;
      combined.activity.push(...project.activity);
      projects.set(project.name, combined);
    }
  }
  return [...projects.values()].sort((a, b) => b.commits - a.commits || b.pushes - a.pushes || a.name.localeCompare(b.name));
}

function renderProjects(projects) {
  const query = search.value.trim().toLowerCase();
  const matches = projects.flatMap((project) => {
    if (project.name.toLowerCase().includes(query)) return [project];
    const activity = project.activity.filter((event) => event.subject.toLowerCase().includes(query));
    return activity.length ? [{ ...project, activity }] : [];
  });
  projectCount.textContent = query
    ? `${matches.length} of ${projects.length} projects`
    : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;
  projectsContainer.replaceChildren(...matches.map((project) => {
    const item = element("details", undefined, "project");
    const summary = element("summary");
    summary.append(
      element("strong", project.name),
      element("span", `${number.format(project.commits)} ${project.commits === 1 ? "commit" : "commits"}`, "repo-stats"),
      element("span", `${number.format(project.pushes)} ${project.pushes === 1 ? "push" : "pushes"}`, "repo-stats"),
    );
    item.append(summary);
    item.addEventListener("toggle", () => {
      if (!item.open || item.querySelector("ol")) return;
      const list = element("ol");
      for (const event of project.activity) {
        const row = element("li");
        const date = element("time", dayLabel(event.date));
        date.dateTime = event.date;
        date.title = event.date;
        row.append(date, element("span", event.kind === "commit" ? "Commit" : "Push", "event-kind"), element("span", event.subject));
        list.append(row);
      }
      item.append(list);
    });
    return item;
  }));
  if (!matches.length) projectsContainer.append(element("p", query ? "No matching activity." : "No GitHub activity in this period.", "empty"));
}

function makeMonthlySeries(month, coverage, through) {
  const dates = new Map(month.agentDays.map((day) => [day.localDate, day]));
  const [year, numberOfMonth] = month.month.split("-").map(Number);
  const length = new Date(Date.UTC(year, numberOfMonth, 0)).getUTCDate();
  const series = [];
  for (let day = 1; day <= length; day += 1) {
    const date = `${month.month}-${String(day).padStart(2, "0")}`;
    if (date > through.today) break;
    const hasAgents = coverage.agentsFrom && date >= coverage.agentsFrom && date <= through.agents;
    series.push({
      date,
      label: dayLabel(date),
      tick: day === 1 || day % 5 === 0 ? String(day) : "",
      commits: through.commits && date <= through.commits ? 0 : null,
      pushes: through.pushes && date <= through.pushes ? 0 : null,
      agents: dates.get(date)?.agents ?? (hasAgents ? 0 : null),
      subagents: dates.get(date)?.subagents ?? (hasAgents ? 0 : null),
    });
  }
  const byDate = new Map(series.map((day) => [day.date, day]));
  for (const project of month.projects) {
    for (const event of project.activity) {
      const day = byDate.get(event.date);
      if (!day) continue;
      const key = event.kind === "commit" ? "commits" : "pushes";
      day[key] = (day[key] ?? 0) + 1;
    }
  }
  return series;
}

function totalsForSeries(series) {
  return Object.fromEntries(Object.keys(chartLabels).map((key) => [key, sumObserved(series.map((item) => item[key]))]));
}

function renderChart(series) {
  const key = chartMetric.value;
  const label = chartLabels[key];
  const largest = Math.max(1, ...series.map((item) => item[key] ?? 0));
  const buttons = [];
  const select = (index) => {
    const item = series[index];
    buttons.forEach((button, position) => {
      button.setAttribute("aria-pressed", String(position === index));
      button.tabIndex = position === index ? 0 : -1;
    });
    chartDetail.replaceChildren(
      element("strong", item.label),
      ...Object.keys(chartLabels).map((metric) => element("span", `${valueLabel(item[metric])} ${chartLabels[metric].toLowerCase()}`)),
    );
  };
  for (const [index, item] of series.entries()) {
    const button = element("button");
    button.type = "button";
    button.setAttribute("aria-label", `${item.label}, ${item[key] === null ? `${label.toLowerCase()} unavailable` : `${valueLabel(item[key])} ${label.toLowerCase()}`}`);
    if (item[key] === null) button.dataset.missing = "";
    const bar = element("span", undefined, "bar");
    bar.style.setProperty("--height", `${100 * (item[key] ?? 0) / largest}%`);
    const tick = element("span", item.tick, "tick");
    tick.setAttribute("aria-hidden", "true");
    button.append(bar, tick);
    button.addEventListener("click", () => select(index));
    button.addEventListener("keydown", (event) => {
      const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: series.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target = Math.max(0, Math.min(next, series.length - 1));
      select(target);
      buttons[target].focus();
    });
    buttons.push(button);
  }
  chart.replaceChildren(...buttons);
  if (buttons.length) select(buttons.length - 1);
  else chartDetail.replaceChildren();
}

function renderMetrics(totals, months, projects) {
  const metricsData = [
    ["Projects", projects.length],
    ["Commits", totals.commits],
    ["Pushes", totals.pushes],
    ["Observed tokens", sumObserved(months.map((month) => month.tokens))],
    ["Agents", totals.agents],
    ["Subagents", totals.subagents],
  ];
  metrics.replaceChildren(...metricsData.map(([label, value]) => {
    const group = element("div");
    const amount = element("dd", value !== null && value >= 100_000 ? compact.format(value) : valueLabel(value));
    amount.title = value === null ? "Data unavailable" : valueLabel(value);
    group.append(element("dt", label), amount);
    return group;
  }));
}

function dateInZone(value, timeZone) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type).value).join("-");
}

async function showDashboard() {
  const response = await fetch(new URL("./activity.json", import.meta.url), { cache: "no-cache" });
  if (!response.ok) throw new Error("Activity request failed");
  const data = await response.json();
  if (data.schemaVersion !== 1 || !Array.isArray(data.months) || !data.months.length) {
    throw new Error("Unsupported activity file");
  }
  const through = {
    today: dateInZone(data.generatedAt, data.timeZone),
    commits: dateInZone(data.coverage.commitsAt, data.timeZone),
    pushes: dateInZone(data.coverage.pushesAt, data.timeZone),
    agents: dateInZone(data.coverage.agentsAt, data.timeZone),
  };
  const updateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.timeZone });
  const updateDate = updateFormat.format(new Date(data.generatedAt));
  updated.textContent = `Updated ${updateDate}`;
  updated.title = data.timeZone;
  updated.hidden = false;
  sourceUpdates.textContent = [
    ["GitHub commits", data.coverage.commitsAt],
    ["GitHub pushes", data.coverage.pushesAt],
    ["Codex agents", data.coverage.agentsAt],
  ].map(([name, instant]) => instant ? `${name} through ${updateFormat.format(new Date(instant))}` : `${name} unavailable`).join(" · ");
  period.append(new Option("All recorded", "all"), ...data.months.map((month) => new Option(monthLabel(month.month), month.month)));
  const queryPeriod = new URLSearchParams(location.search).get("month");
  if (data.months.some((month) => month.month === queryPeriod)) period.value = queryPeriod;

  const byMonth = new Map(data.months.map((month) => {
    const days = makeMonthlySeries(month, data.coverage, through);
    return [month.month, { days, totals: totalsForSeries(days) }];
  }));
  const overview = [...data.months].reverse().map(({ month }) => ({
    ...byMonth.get(month).totals,
    label: monthLabel(month),
    tick: monthLabel(month).slice(0, 3),
  }));

  let projects = [];
  let series = [];
  function renderPeriod() {
    const months = period.value === "all" ? data.months : data.months.filter((month) => month.month === period.value);
    projects = combineProjects(months);
    series = period.value === "all" ? overview : byMonth.get(period.value).days;
    renderMetrics(totalsForSeries(series), months, projects);
    renderChart(series);
    renderProjects(projects);
  }
  period.addEventListener("change", () => {
    const url = new URL(location.href);
    if (period.value === "all") url.searchParams.delete("month");
    else url.searchParams.set("month", period.value);
    history.replaceState(null, "", url);
    renderPeriod();
  });
  chartMetric.addEventListener("change", () => renderChart(series));
  search.addEventListener("input", () => renderProjects(projects));
  renderPeriod();
  status.hidden = true;
  dashboard.hidden = false;
}

showDashboard().catch(() => {
  status.textContent = "Work history is temporarily unavailable.";
});
