import { mergeGitHubHistory } from "./github-history.js?v=1";

const status = document.querySelector("#status");
const dashboard = document.querySelector("#dashboard");
const updated = document.querySelector("#updated");
const syncDevices = document.querySelector("#sync-devices");
const syncCaption = document.querySelector("#sync-caption");
const period = document.querySelector("#period");
const chartMetric = document.querySelector("#chart-metric");
const chartPeriod = document.querySelector("#chart-period");
const chart = document.querySelector("#chart");
const chartDetail = document.querySelector("#chart-detail");
const heatmapGrid = document.querySelector("#heatmap-grid");
const heatmapDetail = document.querySelector("#heatmap-detail");
const heatmapMetrics = [...document.querySelectorAll(".heatmap-metrics button")];
const search = document.querySelector("#search");
const projectsContainer = document.querySelector("#projects");
const projectCount = document.querySelector("#project-count");
const metrics = document.querySelector("#metrics");
const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const heatmapDateFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const chartLabels = { commits: "Commits", pushes: "Pushes", agents: "Agents", subagents: "Subagents" };
const githubCommitUrl = /^https:\/\/github\.com\/[a-z0-9-]+\/[a-z0-9_.-]+\/commit\/[0-9a-f]{40,64}$/i;
const heatmapDayCount = 90;
const staleAfterMinutes = 35;

function initializePalette() {
  const switcher = document.querySelector(".palette-switcher");
  if (!switcher) return;

  const buttons = [...switcher.querySelectorAll("[data-palette-option]")];
  const root = document.documentElement;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const storageKey = "worklog.palette";
  function selectPalette(name) {
    root.dataset.palette = name;
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.paletteOption === name)));
    themeColor.content = getComputedStyle(root).getPropertyValue("--canvas").trim();
  }

  let saved;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {
    // Palette changes still work when browser storage is restricted.
  }
  if (buttons.some((button) => button.dataset.paletteOption === saved)) selectPalette(saved);
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const name = button.dataset.paletteOption;
      selectPalette(name);
      try {
        localStorage.setItem(storageKey, name);
      } catch {
        // Keep the current page's selection if storage is restricted.
      }
    });
  }
  switcher.hidden = false;
}

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
        const linked = event.kind === "commit" && typeof event.url === "string" && githubCommitUrl.test(event.url);
        const subject = element(linked ? "a" : "span", event.subject, "event-subject");
        if (linked) subject.href = event.url;
        row.append(date, element("span", event.kind === "commit" ? "Commit" : "Push", "event-kind"), subject);
        list.append(row);
      }
      item.append(list);
    });
    return item;
  }));
  if (!matches.length) projectsContainer.append(element("p", query ? "No matching activity." : "No GitHub activity in this period.", "empty"));
}

function makeMonthlySeries(month, agentCoverage, through) {
  const dates = new Map(month.agentDays.map((day) => [day.localDate, day]));
  const [year, numberOfMonth] = month.month.split("-").map(Number);
  const length = new Date(Date.UTC(year, numberOfMonth, 0)).getUTCDate();
  const series = [];
  for (let day = 1; day <= length; day += 1) {
    const date = `${month.month}-${String(day).padStart(2, "0")}`;
    if (date > through.today) break;
    const hasAgents = agentCoverage.some(({ from, to }) => from && date >= from && date <= to);
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

function renderDayDetails(container, heading, item) {
  const totals = element("dl");
  for (const [key, label] of Object.entries(chartLabels)) {
    const group = element("div");
    group.append(element("dt", label), element("dd", item[key] === null ? "Unavailable" : valueLabel(item[key])));
    totals.append(group);
  }
  container.replaceChildren(heading, totals);
}

function renderHeatmap(daySeries, latestDate) {
  // Cached visits can briefly have the previous HTML while assets are deployed.
  if (!heatmapGrid) return;
  const byDate = new Map(daySeries.map((day) => [day.date, day]));
  const cursor = new Date(`${latestDate}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - heatmapDayCount + 1);
  const offset = (cursor.getUTCDay() + 6) % 7;
  const weeks = Math.ceil((offset + heatmapDayCount) / 7);
  const days = Array.from({ length: heatmapDayCount }, () => {
    const date = cursor.toISOString().slice(0, 10);
    const day = byDate.get(date) ?? { date, commits: null, pushes: null, agents: null, subagents: null };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return day;
  });
  heatmapGrid.style.setProperty("--weeks", weeks);
  const labels = new Map();
  const weekday = ["Mon", "", "Wed", "", "Fri", "", ""];
  const weekdayLabels = weekday.map((name, index) => {
    const label = element("span", name, "heatmap-weekday");
    label.style.gridRow = index + 2;
    label.setAttribute("aria-hidden", "true");
    return label;
  });
  const dates = days.map(({ date }) => heatmapDateFormat.format(new Date(`${date}T00:00:00Z`)));
  let selected = days.length - 1;
  function select(index) {
    buttons[selected].setAttribute("aria-pressed", "false");
    buttons[selected].tabIndex = -1;
    selected = index;
    buttons[index].setAttribute("aria-pressed", "true");
    buttons[index].tabIndex = 0;
    const date = element("time", dates[index]);
    date.dateTime = days[index].date;
    renderDayDetails(heatmapDetail, date, days[index]);
  }

  const buttons = days.map((day, index) => {
    const column = 2 + Math.floor((offset + index) / 7);
    const row = (offset + index) % 7;
    if (index === 0 || day.date.endsWith("-01")) {
      labels.set(column, monthLabel(day.date.slice(0, 7)).slice(0, 3));
    }
    const button = element("button", undefined, "heatmap-day");
    button.type = "button";
    button.style.gridColumn = column;
    button.style.gridRow = row + 2;
    button.setAttribute("aria-pressed", "false");
    button.tabIndex = -1;
    button.addEventListener("click", () => select(index));
    button.addEventListener("keydown", (event) => {
      const next = {
        ArrowLeft: index - 7,
        ArrowRight: index + 7,
        ArrowUp: index - (row > 0 ? 1 : 0),
        ArrowDown: index + (row < 6 ? 1 : 0),
        Home: 0,
        End: days.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      if (next < 0 || next >= days.length) return;
      select(next);
      buttons[next].focus();
    });
    return button;
  });
  const monthLabels = Array.from(labels, ([column, name]) => {
    const label = element("span", name, "heatmap-month");
    label.style.gridColumn = column;
    label.setAttribute("aria-hidden", "true");
    return label;
  });
  heatmapGrid.replaceChildren(...monthLabels, ...weekdayLabels, ...buttons);

  function showMetric(key) {
    const max = Math.max(1, ...days.map((day) => day[key] ?? 0));
    heatmapMetrics.forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.metric === key)));
    buttons.forEach((button, index) => {
      const value = days[index][key];
      button.dataset.level = value > 0 ? Math.ceil(4 * Math.sqrt(value / max)) : 0;
      button.classList.toggle("heatmap-missing", value === null);
      const label = `${dates[index]} · ${chartLabels[key]} ${value === null ? "unavailable" : valueLabel(value)}`;
      button.title = label;
      button.setAttribute("aria-label", label);
    });
  }

  heatmapMetrics.forEach((control) => {
    control.addEventListener("click", () => showMetric(control.dataset.metric));
  });
  showMetric("commits");
  select(selected);
  const scroll = heatmapGrid.parentElement;
  scroll.scrollLeft = scroll.scrollWidth;
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
    renderDayDetails(chartDetail, element("strong", item.label), item);
  };
  for (const [index, item] of series.entries()) {
    const button = element("button");
    button.type = "button";
    const description = `${item.label}, ${item[key] === null ? `${label.toLowerCase()} unavailable` : `${valueLabel(item[key])} ${label.toLowerCase()}`}`;
    button.setAttribute("aria-label", description);
    button.title = description;
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
  chart.style.setProperty("--points", Math.max(1, buttons.length));
  chart.replaceChildren(...buttons);
  if (buttons.length) {
    select(buttons.length - 1);
    const scroll = chart.parentElement;
    scroll.scrollLeft = scroll.scrollWidth;
  } else {
    chartDetail.textContent = "No activity dates in this period.";
  }
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
    amount.toggleAttribute("data-unavailable", value === null);
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

async function loadDevices(timeZone) {
  try {
    const response = await fetch(new URL("./codex-devices.json", import.meta.url), {
      cache: "no-cache", signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Device activity request failed");
    const feed = await response.json();
    if (feed.schemaVersion !== 1 || feed.timeZone !== timeZone || !feed.devices) {
      throw new Error("Unsupported device activity file");
    }
    return Object.entries(feed.devices);
  } catch {
    return [];
  }
}

function renderSyncStatus(primary, devices, timeZone) {
  if (!syncDevices || !syncCaption) return;
  const now = Date.now();
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" })
    .formatToParts(now).find(({ type }) => type === "timeZoneName")?.value ?? timeZone;
  syncCaption.textContent = `Last successful reports in ${zone}. Stale after ${staleAfterMinutes} minutes.`;

  const labels = new Map([["windows-pc", "Windows PC"], ["mac-mini", "Mac mini"]]);
  const additional = new Map([["windows-pc", null], ...devices]);
  const rows = [
    ["MacBook Pro", primary.commitsAt, primary.pushesAt, primary.agentsAt],
    ...Array.from(additional, ([key, device]) => [
      labels.get(key) ?? key.replaceAll("-", " "), device?.git?.commitsAt, device?.git?.pushesAt, device?.syncedAt,
    ]),
  ];
  syncDevices.replaceChildren(...rows.map(([name, ...instants]) => {
    const row = element("tr");
    const device = element("th", name);
    device.scope = "row";
    row.append(device);
    for (const instant of instants) {
      const timestamp = Date.parse(instant);
      const cell = element("td");
      const state = !Number.isFinite(timestamp) ? "Unavailable"
        : now - timestamp >= staleAfterMinutes * 60_000 ? "Stale" : "Current";
      const label = element("span", state, "sync-state");
      label.dataset.state = state.toLowerCase();
      cell.append(label);
      if (Number.isFinite(timestamp)) {
        const time = element("time", format.format(timestamp), "sync-time");
        time.dateTime = instant;
        time.title = new Date(timestamp).toISOString();
        cell.append(time);
      }
      row.append(cell);
    }
    return row;
  }));
}

function combineDeviceMonths(primaryMonths, devices) {
  const months = new Map(primaryMonths.map((month) => [month.month, month]));
  for (const [, device] of devices) {
    for (const { month, tokens, agentDays } of device.months) {
      const previous = months.get(month) ?? { month, tokens: null, agentDays: [], projects: [] };
      const days = new Map(previous.agentDays.map((day) => [day.localDate, day]));
      for (const day of agentDays) {
        const before = days.get(day.localDate);
        days.set(day.localDate, {
          localDate: day.localDate,
          agents: (before?.agents ?? 0) + day.agents,
          subagents: (before?.subagents ?? 0) + day.subagents,
        });
      }
      months.set(month, {
        ...previous,
        tokens: sumObserved([previous.tokens, tokens]),
        agentDays: [...days.values()],
      });
    }
  }
  const git = mergeGitHubHistory([primaryMonths, ...devices.flatMap(([, device]) => device.git ? [device.git.months] : [])]);
  for (const [month, projects] of git) {
    months.set(month, { ...(months.get(month) ?? { month, tokens: null, agentDays: [] }), projects });
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

async function showDashboard() {
  const response = await fetch(new URL("./activity.json", import.meta.url), { cache: "no-cache" });
  if (!response.ok) throw new Error("Activity request failed");
  const data = await response.json();
  if (data.schemaVersion !== 1 || !Array.isArray(data.months) || !data.months.length) {
    throw new Error("Unsupported activity file");
  }
  const devices = await loadDevices(data.timeZone);
  const monthsWithActivity = combineDeviceMonths(data.months, devices);
  const newest = (instants) => instants.reduce((latest, instant) =>
    instant && (!latest || Date.parse(instant) > Date.parse(latest)) ? instant : latest, null);
  const deviceGit = devices.flatMap(([, device]) => device.git ? [device.git] : []);
  const commitsAt = newest([data.coverage.commitsAt, ...deviceGit.map((git) => git.commitsAt)]);
  const pushesAt = newest([data.coverage.pushesAt, ...deviceGit.map((git) => git.pushesAt)]);
  const latest = newest([data.generatedAt, commitsAt, pushesAt, ...devices.map(([, device]) => device.syncedAt)]);
  const through = {
    today: dateInZone(latest, data.timeZone),
    commits: dateInZone(commitsAt, data.timeZone),
    pushes: dateInZone(pushesAt, data.timeZone),
  };
  const agentCoverage = [{ agentsFrom: data.coverage.agentsFrom, syncedAt: data.coverage.agentsAt },
    ...devices.map(([, device]) => device)].map(({ agentsFrom, syncedAt }) => ({
    from: agentsFrom, to: dateInZone(syncedAt, data.timeZone),
  }));
  const updateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.timeZone });
  const updateDate = element("time", updateFormat.format(new Date(latest)));
  updateDate.dateTime = latest;
  updated.replaceChildren("Updated ", updateDate);
  updated.title = data.timeZone;
  updated.hidden = false;
  renderSyncStatus(data.coverage, devices, data.timeZone);
  period.append(new Option("All recorded", "all"), ...monthsWithActivity.map((month) => new Option(monthLabel(month.month), month.month)));
  const queryPeriod = new URLSearchParams(location.search).get("month");
  if (monthsWithActivity.some((month) => month.month === queryPeriod)) period.value = queryPeriod;

  const byMonth = new Map(monthsWithActivity.map((month) => {
    const days = makeMonthlySeries(month, agentCoverage, through);
    return [month.month, { days, totals: totalsForSeries(days) }];
  }));
  const overview = [...monthsWithActivity].reverse().map(({ month }) => ({
    ...byMonth.get(month).totals,
    label: monthLabel(month),
    tick: monthLabel(month).slice(0, 3),
  }));

  let projects = [];
  let series = [];
  function renderPeriod() {
    const months = period.value === "all" ? monthsWithActivity : monthsWithActivity.filter((month) => month.month === period.value);
    projects = combineProjects(months);
    series = period.value === "all" ? overview : byMonth.get(period.value).days;
    if (chartPeriod) {
      chartPeriod.textContent = period.value === "all" ? "Monthly totals · All recorded" : `Daily totals · ${monthLabel(period.value)}`;
    }
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
  dashboard.hidden = false;
  renderPeriod();
  renderHeatmap([...byMonth.values()].flatMap(({ days }) => days), through.today);
  status.hidden = true;
  document.querySelectorAll("[data-dashboard-link]").forEach((link) => { link.hidden = false; });
  if (location.hash === "#history-title" || location.hash === "#sync-title") {
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
}

initializePalette();
showDashboard().catch(() => {
  dashboard.hidden = true;
  status.textContent = "Work history is temporarily unavailable.";
});
