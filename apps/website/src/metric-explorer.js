import { buildMetricSeries, metricDefinitions, metricSummary, rollingDateRange, seriesCsv } from "./metric-series.js?v=3";

const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const format = (value) => value === null ? "Unavailable" : full.format(value);
const short = (value) => value >= 10000 ? compact.format(value) : full.format(value);
const utc = (date) => new Date(`${date}T00:00:00Z`);
const dateString = (date) => date.toISOString().slice(0, 10);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function svgNode(tag, attrs = {}, text) {
  const result = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
  if (text !== undefined) result.textContent = text;
  return result;
}

// Monotone cubic curves pass through every observation without inventing peaks
// or dipping below a pair of observed values. Gaps are drawn separately.
function curvePath(points) {
  const slopes = points.slice(1).map((point, index) => (point.y - points[index].y) / (point.x - points[index].x));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === points.length - 1) return slopes.at(-1);
    const before = slopes[index - 1], after = slopes[index];
    return before * after <= 0 ? 0 : 2 * before * after / (before + after);
  });
  return points.map((point, index) => {
    if (index === 0) return `M${point.x},${point.y}`;
    const previous = points[index - 1];
    const handle = (point.x - previous.x) / 3;
    return `C${previous.x + handle},${previous.y + tangents[index - 1] * handle} ${point.x - handle},${point.y - tangents[index] * handle} ${point.x},${point.y}`;
  }).join(" ");
}

export function createMetricExplorer({ months, days, latestDate, metrics, charts, today }) {
  if (!charts) return { refresh() {} };
  const panel = node("section", undefined, "metric-explorer panel");
  panel.id = "metric-explorer";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "explorer-title");
  panel.innerHTML = `
    <div class="explorer-heading">
      <div><p class="explorer-eyebrow">Activity explorer</p><h2 id="explorer-title" tabindex="-1"></h2></div>
      <button type="button" class="explorer-collapse" aria-label="Collapse chart and return to activity overview" title="Collapse chart (Escape)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></svg></button>
    </div>
    <div class="explorer-toolbar">
      <label class="field">Metric <select class="explorer-metric"></select></label>
      <div class="explorer-ranges" role="group" aria-label="Chart date range">
        <button type="button" data-range="today">24H</button><button type="button" data-range="30">30D</button><button type="button" data-range="3">3M</button><button type="button" data-range="6">6M</button><button type="button" data-range="12">1Y</button><button type="button" data-range="all">All</button><button type="button" data-range="custom">Custom</button>
      </div>
      <label class="field">Group by <select class="explorer-group"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
    </div>
    <div class="explorer-custom" hidden><label class="field">From <input class="explorer-start" type="date" required></label><label class="field">To <input class="explorer-end" type="date" required></label><span class="explorer-date-error" role="status"></span></div>
    <p class="explorer-period caption"></p>
    <dl class="explorer-stats"></dl>
    <div class="explorer-viewbar">
      <div class="explorer-views" role="group" aria-label="Chart view"><button type="button" data-view="chart" aria-pressed="true">Line chart</button><button type="button" data-view="table" aria-pressed="false">Data table</button></div>
      <div class="explorer-options"><label><input type="checkbox" class="explorer-fill" checked> Area fill</label><label><input type="checkbox" class="explorer-dots" checked> Points</label><button type="button" class="explorer-export">Export CSV <span aria-hidden="true">↓</span></button></div>
    </div>
    <div class="explorer-plot"><svg class="explorer-svg" tabindex="0" role="group" aria-label="Activity line chart. Use left and right arrow keys to inspect dates, Home and End for first and last date." aria-describedby="explorer-help"></svg></div>
    <div class="explorer-table-wrap" hidden><table class="explorer-table"><caption class="explorer-table-caption"></caption><thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Coverage</th></tr></thead><tbody></tbody></table></div>
    <div class="explorer-inspector"><div><span class="explorer-inspect-date"></span><strong class="explorer-inspect-value"></strong><span class="explorer-inspect-quality"></span></div><div class="explorer-stepper"><button type="button" class="explorer-prev" aria-label="Inspect previous date">←</button><button type="button" class="explorer-next" aria-label="Inspect next date">→</button></div></div>
    <div class="explorer-foot"><p class="explorer-coverage"></p><p id="explorer-help">Hover or touch to inspect · Click to pin · ← → move · Esc collapse</p></div>
    <p class="explorer-note"></p><p class="explorer-announcement" role="status"></p>`;
  charts.before(panel);
  const $ = (selector) => panel.querySelector(selector);
  const metricControl = $(".explorer-metric");
  const groupControl = $(".explorer-group");
  const startControl = $(".explorer-start");
  const endControl = $(".explorer-end");
  const svg = $(".explorer-svg");
  const earliest = [...months.map(({ month }) => `${month}-01`), ...days.map(({ date }) => date)].sort()[0] ?? latestDate;
  let metric = "commits", range = "all", group = "month", points = [], selected = 0, open = false, pinned = false, view = "chart";
  let opener = null, crosshair, marker, coordinates = [], dimensions, currentPeriod = "all";
  for (const [key, definition] of Object.entries(metricDefinitions)) metricControl.add(new Option(definition.label, key));
  $('[data-range="today"]').hidden = !today;
  startControl.value = earliest;
  endControl.value = latestDate;
  for (const input of [startControl, endControl]) { input.min = earliest; input.max = latestDate; }

  function refreshCards() {
    for (const button of metrics.querySelectorAll("[data-explorer-metric]")) {
      button.setAttribute("aria-expanded", String(open && button.dataset.explorerMetric === metric));
    }
  }
  function animate(target) {
    if (!reducedMotion()) target.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
  }
  function close() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    charts.hidden = false;
    refreshCards();
    animate(charts);
    const target = metrics.querySelector(`[data-explorer-metric="${metric}"]`) ?? opener;
    target?.focus({ preventScroll: true });
  }
  function bounds() {
    let start = earliest, end = latestDate;
    if (range === "today" && today) return { start: today.bounds.start, end: today.bounds.end };
    if (range === "custom") { start = startControl.value; end = endControl.value; }
    else if (range === "30") return rollingDateRange(latestDate);
    else if (range !== "all") {
      const date = utc(latestDate);
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() - Number(range) + 1);
      start = dateString(date) < earliest ? earliest : dateString(date);
    }
    if (metric === "tokens") {
      start = `${start.slice(0, 7)}-01`;
      const monthEnd = utc(`${end.slice(0, 7)}-01`);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1); monthEnd.setUTCDate(0);
      end = dateString(monthEnd) < latestDate ? dateString(monthEnd) : latestDate;
    }
    return { start, end };
  }
  function quality(point) { return point.value === null ? "Unavailable" : point.partial ? "Partial" : "Observed"; }
  function inspect(index) {
    if (!points.length) return;
    selected = Math.max(0, Math.min(index, points.length - 1));
    const point = points[selected];
    $(".explorer-inspect-date").textContent = point.label;
    $(".explorer-inspect-value").textContent = `${format(point.value)}${point.value === null ? "" : ` ${metricDefinitions[metric].label.toLowerCase()}`}`;
    $(".explorer-inspect-quality").textContent = `${quality(point)}${pinned ? " · Pinned" : ""}`;
    $(".explorer-prev").disabled = selected === 0;
    $(".explorer-next").disabled = selected === points.length - 1;
    if (crosshair && coordinates[selected]) {
      const { x, y } = coordinates[selected];
      crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x);
      marker.setAttribute("cx", x); marker.setAttribute("cy", y ?? dimensions.bottom);
      marker.setAttribute("data-missing", String(y === null));
    }
    svg.setAttribute("aria-label", `${point.label}: ${format(point.value)} ${metricDefinitions[metric].label.toLowerCase()}, ${quality(point)}. Use arrow keys to inspect dates.`);
  }
  function draw() {
    if (!open || view !== "chart") return;
    const width = Math.max(280, Math.round(svg.clientWidth));
    const height = width < 550 ? 280 : 320;
    const left = metric === "tokens" ? 58 : 48, right = width - 20, top = 24, bottom = height - 38;
    dimensions = { left, right, top, bottom };
    const max = Math.max(1, ...points.map(({ value }) => value ?? 0));
    const magnitude = 10 ** Math.floor(Math.log10(max / 4));
    const step = Math.max(1, [1, 2, 2.5, 3, 4, 5, 6, 8, 10].find((value) => value * magnitude >= max / 4) * magnitude);
    const ceiling = step * 4;
    const rollingTokens = metric === "tokens" && range === "30";
    const window = bounds();
    const x = (index) => rollingTokens
      ? left + (right - left) * (+utc(points[index].endDate) - +utc(window.start)) / (+utc(window.end) - +utc(window.start))
      : points.length < 2 ? (left + right) / 2 : left + (right - left) * index / (points.length - 1);
    const y = (value) => bottom - (bottom - top) * value / ceiling;
    coordinates = points.map((point, index) => ({ x: x(index), y: point.value === null ? null : y(point.value) }));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren();
    const defs = svgNode("defs");
    const pattern = svgNode("pattern", { id: "explorer-grid", width: 18, height: 18, patternUnits: "userSpaceOnUse" });
    pattern.append(svgNode("circle", { cx: 1, cy: 1, r: .8, class: "explorer-grid-dot" }));
    const gradient = svgNode("linearGradient", { id: "explorer-gradient", x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(svgNode("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": ".2" }), svgNode("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": ".01" }));
    defs.append(pattern, gradient); svg.append(defs);
    svg.append(svgNode("rect", { x: left, y: top, width: right - left, height: bottom - top, rx: 10, fill: "url(#explorer-grid)" }));
    for (let i = 0; i <= 4; i++) {
      const value = ceiling * i / 4, cy = y(value);
      svg.append(svgNode("line", { x1: left, x2: right, y1: cy, y2: cy, class: "explorer-guide" }), svgNode("text", { x: left - 10, y: cy + 4, "text-anchor": "end", class: "explorer-axis" }, short(value)));
    }
    svg.append(svgNode("text", { x: left, y: 12, class: "explorer-axis" }, metricDefinitions[metric].label));
    const tickCount = rollingTokens ? (width < 550 ? 3 : 6) : Math.min(width < 550 ? 3 : 6, points.length);
    const ticks = new Set(Array.from({ length: tickCount }, (_, i) => rollingTokens ? i : Math.round(i * (points.length - 1) / Math.max(1, tickCount - 1))));
    for (const i of ticks) {
      const fraction = i / Math.max(1, tickCount - 1);
      const date = rollingTokens ? new Date(+utc(window.start) + Math.round(fraction * 29) * 86_400_000) : utc(points[i].date);
      const label = (rollingTokens || groupControl.value !== "month" ? dateFormat : monthFormat).format(date);
      svg.append(svgNode("text", { x: rollingTokens ? left + (right - left) * (+date - +utc(window.start)) / (+utc(window.end) - +utc(window.start)) : x(i), y: height - 13, "text-anchor": i === 0 ? "start" : i === (rollingTokens ? tickCount : points.length) - 1 ? "end" : "middle", class: "explorer-axis" }, label));
    }
    let segments = [], segment = [];
    coordinates.forEach((point) => {
      if (point.y === null) { if (segment.length) segments.push(segment); segment = []; }
      else segment.push(point);
    });
    if (segment.length) segments.push(segment);
    for (const line of segments) {
      const path = curvePath(line);
      if ($(".explorer-fill").checked) svg.append(svgNode("path", { d: `${path} L${line.at(-1).x},${bottom} L${line[0].x},${bottom} Z`, fill: "url(#explorer-gradient)" }));
      svg.append(svgNode("path", { d: path, class: "explorer-line", pathLength: 1 }));
    }
    coordinates.forEach(({ x, y }, i) => {
      if (y === null) {
        svg.append(svgNode("line", { x1: x - 2, x2: x + 2, y1: bottom + 5, y2: bottom + 5, class: "explorer-missing-mark" }));
      } else if ($(".explorer-dots").checked || points.length === 1 || points[i].partial) {
        svg.append(svgNode("circle", { cx: x, cy: y, r: points.length > 100 ? 1.8 : 3.5, class: points[i].partial ? "explorer-point partial" : "explorer-point" }));
      }
    });
    if (points.every(({ value }) => value === null)) svg.append(svgNode("text", { x: (left + right) / 2, y: (top + bottom) / 2, "text-anchor": "middle", class: "explorer-empty" }, "No observations in this range"));
    crosshair = svgNode("line", { y1: top, y2: bottom, class: "explorer-crosshair" });
    marker = svgNode("circle", { r: 5, class: "explorer-marker" });
    svg.append(crosshair, marker);
    inspect(selected);
  }
  function renderTable() {
    $(".explorer-table-caption").textContent = range === "today" && metric === "tokens"
      ? "Observed tokens · Last 24 hours" : `${metricDefinitions[metric].label} by ${groupControl.value}`;
    const rows = points.map((point) => {
      const row = node("tr");
      const heading = node("th", point.label); heading.scope = "row";
      row.append(heading, node("td", format(point.value)), node("td", quality(point)));
      return row;
    });
    $("tbody").replaceChildren(...rows);
  }
  function render() {
    const isToday = range === "today" && today;
    const windowTokens = isToday && metric === "tokens";
    const monthlyOnly = metric === "tokens" && !isToday;
    groupControl.disabled = monthlyOnly || windowTokens;
    groupControl.value = windowTokens ? "day" : monthlyOnly ? "month" : group;
    metricControl.value = metric;
    for (const button of panel.querySelectorAll("[data-range]")) button.setAttribute("aria-pressed", String(button.dataset.range === range));
    $(".explorer-custom").hidden = range !== "custom";
    const validCustom = range !== "custom" || (startControl.validity.valid && endControl.validity.valid && startControl.value <= endControl.value);
    $(".explorer-export").disabled = !validCustom;
    if (!validCustom) {
      $(".explorer-date-error").textContent = "Choose a valid date range within the recorded history.";
      return;
    }
    const { start, end } = bounds();
    if (!start || !end || start > end || (start < earliest && range !== "30" && range !== "today") || end > latestDate) {
      $(".explorer-date-error").textContent = "Choose a valid date range within the recorded history.";
      return;
    }
    $(".explorer-date-error").textContent = "";
    points = windowTokens
      ? [{ date: end, endDate: end, label: "Last 24 hours", value: today.tokens, partial: today.tokensKnowledge === "partial" }]
      : buildMetricSeries(isToday ? { months: today.months, days: today.days } : { months, days }, metric, { start, end, group: groupControl.value });
    selected = Math.max(0, points.findLastIndex(({ value }) => value !== null));
    pinned = false;
    const summary = metricSummary(points, metric);
    const label = metricDefinitions[metric].label;
    $("#explorer-title").textContent = label;
    const groupLabel = { day: "Daily", week: "Weekly", month: "Monthly" }[groupControl.value];
    $(".explorer-period").textContent = isToday
      ? `${today.label ?? "Last 24 hours"}${windowTokens ? " · One window observation" : ` · ${groupLabel} observations`}`
      : `${start} — ${end} · ${groupLabel} observations${monthlyOnly && range === "30" ? " (full-month totals)" : ""}`;
    const interval = windowTokens ? "window" : groupControl.value;
    const stats = [
      [metric === "projects" ? "Distinct projects" : monthlyOnly && range === "30" ? "Published month totals" : "Observed total", summary.total],
      [`Average / ${interval}`, summary.average],
      [`Peak ${interval}`, summary.peak?.value ?? null],
      ["Observed points", `${summary.available} / ${points.length}`],
    ];
    $(".explorer-stats").replaceChildren(...stats.map(([name, value]) => {
      const item = node("div");
      item.append(node("dt", name), node("dd", typeof value === "string" ? value : value === null ? "—" : short(value)));
      if (name.startsWith("Peak") && summary.peak) item.append(node("span", summary.peak.label, "explorer-stat-caption"));
      return item;
    }));
    $(".explorer-coverage").textContent = `${summary.available} observed · ${summary.partial} partial · ${summary.missing} unavailable`;
    $(".explorer-note").textContent = isToday
      ? `${today.reason ?? "Counts cover the same reported 24-hour window across reporting devices."}${today.partialMetrics?.length ? " Some reports are partial or unavailable." : ""} Tokens reflect observed counters for sessions started in this window, separate from account limits.`
      : monthlyOnly
      ? range === "30"
        ? "30D places monthly observations at month-end or the latest reporting date within the 30-day window. Points and stats include full published month totals; an exact 30-day token total is unavailable. Daily breakdowns are unavailable, and these counters are separate from account limits."
        : "Tokens are published as monthly observed totals. Daily and weekly breakdowns are unavailable; selected months are shown in full through their latest report. These counters are separate from account limits."
      : metric === "projects"
        ? "Projects counts distinct repositories with recorded commits or pushes in each interval. The range total counts each project once."
        : "Gaps mark unavailable intervals; hollow points mark partial intervals. Zero is an observed value. Pushes and Codex counts reflect available records; source freshness appears in Sync status.";
    refreshCards(); renderTable(); draw(); inspect(selected);
    $(".explorer-announcement").textContent = `${label}. ${groupLabel} view, ${start} through ${end}.`;
  }
  function openMetric(key, button) {
    metric = key; opener = button;
    if (!open) {
      open = true;
      charts.hidden = true; panel.hidden = false;
      animate(panel);
    }
    render();
    $("#explorer-title").focus({ preventScroll: true });
    const rect = panel.getBoundingClientRect();
    if (rect.top < 0 || rect.top > innerHeight * .7) panel.scrollIntoView({ behavior: reducedMotion() ? "instant" : "smooth", block: "start" });
  }
  metrics.addEventListener("click", (event) => {
    const button = event.target.closest("[data-explorer-metric]");
    if (button) openMetric(button.dataset.explorerMetric, button);
  });
  $(".explorer-collapse").addEventListener("click", close);
  panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
  metricControl.addEventListener("change", () => { metric = metricControl.value; render(); });
  groupControl.addEventListener("change", () => { group = groupControl.value; render(); });
  for (const button of panel.querySelectorAll("[data-range]")) button.addEventListener("click", () => { range = button.dataset.range; render(); });
  for (const input of [startControl, endControl]) input.addEventListener("change", render);
  for (const checkbox of panel.querySelectorAll(".explorer-options input")) checkbox.addEventListener("change", draw);
  for (const button of panel.querySelectorAll("[data-view]")) button.addEventListener("click", () => {
    view = button.dataset.view;
    $(".explorer-plot").hidden = view !== "chart";
    $(".explorer-table-wrap").hidden = view !== "table";
    $(".explorer-fill").disabled = view !== "chart";
    $(".explorer-dots").disabled = view !== "chart";
    for (const item of panel.querySelectorAll("[data-view]")) item.setAttribute("aria-pressed", String(item.dataset.view === view));
    draw();
  });
  function announcePoint() {
    const point = points[selected];
    if (point) $(".explorer-announcement").textContent = `${point.label}: ${format(point.value)} ${metricDefinitions[metric].label.toLowerCase()}, ${quality(point)}.`;
  }
  function move(delta) { pinned = false; inspect(selected + delta); announcePoint(); }
  $(".explorer-prev").addEventListener("click", () => move(-1));
  $(".explorer-next").addEventListener("click", () => move(1));
  svg.addEventListener("keydown", (event) => {
    const index = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: points.length - 1 }[event.key];
    if (index === undefined) return;
    event.preventDefault(); pinned = false; inspect(index); announcePoint();
  });
  function pointAt(event) {
    if (!dimensions) return selected;
    const rect = svg.getBoundingClientRect();
    const plotX = (event.clientX - rect.left) * svg.viewBox.baseVal.width / rect.width;
    if (metric === "tokens" && range === "30") {
      return coordinates.reduce((nearest, point, index) => Math.abs(point.x - plotX) < Math.abs(coordinates[nearest].x - plotX) ? index : nearest, 0);
    }
    return Math.round((plotX - dimensions.left) / (dimensions.right - dimensions.left) * (points.length - 1));
  }
  svg.addEventListener("pointermove", (event) => { if (!pinned) inspect(pointAt(event)); });
  svg.addEventListener("click", (event) => { inspect(pointAt(event)); pinned = !pinned; inspect(selected); });
  $(".explorer-export").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([seriesCsv(points, metric, range === "today" ? today?.bounds : undefined)], { type: "text/csv;charset=utf-8" }));
    const link = node("a"); link.href = url;
    const { start, end } = bounds();
    link.download = `worklog-${metric}-${start}-${end}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $(".explorer-announcement").textContent = "CSV export downloaded.";
  });
  const observer = new ResizeObserver(() => draw());
  observer.observe(panel);
  return {
    refresh(period) {
      refreshCards();
      const key = `${period.mode ?? "dates"}/${period.startAt ?? period.start}/${period.endAt ?? period.end}`;
      if (key === currentPeriod) return;
      currentPeriod = key;
      range = period.mode === "today" ? "today" : "custom";
      group = (+utc(period.end) - +utc(period.start)) / 86400000 > 92 ? "month" : "day";
      startControl.value = period.start;
      endControl.value = period.end;
      if (open) render();
    },
  };
}
