import assert from "node:assert/strict";
import test from "node:test";
import { buildMetricSeries, metricSummary, seriesCsv } from "../src/metric-series.js";

const day = (date, commits, pushes = commits) => ({ date, commits, pushes, agents: commits, subagents: commits });
const options = { start: "2026-11-01", end: "2026-11-03", group: "day" };

test("daily series preserves observed zero, unavailable values, and absent dates", () => {
  const points = buildMetricSeries({ days: [day("2026-11-01", 0), day("2026-11-03", null)] }, "commits", options);
  assert.deepEqual(points.map(({ value, partial }) => ({ value, partial })), [
    { value: 0, partial: false }, { value: null, partial: false }, { value: null, partial: false },
  ]);
  assert.equal(metricSummary(points, "commits").total, 0);
  assert.equal(metricSummary(points, "commits").missing, 2);
});

test("weekly buckets start Monday and clip to selected range", () => {
  const points = buildMetricSeries({ days: [day("2026-11-01", 2), day("2026-11-02", 3)] }, "commits", { ...options, group: "week" });
  assert.deepEqual(points.map(({ date, endDate, value, partial }) => ({ date, endDate, value, partial })), [
    { date: "2026-11-01", endDate: "2026-11-01", value: 2, partial: false },
    { date: "2026-11-02", endDate: "2026-11-03", value: 3, partial: true },
  ]);
});

test("monthly aggregation distinguishes partial sums and wholly missing months", () => {
  const points = buildMetricSeries({ days: [day("2026-10-31", 4), day("2026-11-01", 0)] }, "agents", {
    start: "2026-10-31", end: "2026-12-01", group: "month",
  });
  assert.deepEqual(points.map(({ value, partial }) => ({ value, partial })), [
    { value: 4, partial: false }, { value: 0, partial: true }, { value: null, partial: false },
  ]);
  const summary = metricSummary(points, "agents");
  assert.equal(summary.total, 4);
  assert.equal(summary.average, 2);
  assert.equal(summary.peak.date, "2026-10-31");
  assert.equal(summary.partial, 1);
});

test("project buckets and range totals count distinct names", () => {
  const months = [{ month: "2026-11", projects: [
    { name: "Alpha", activity: [{ date: "2026-11-01", kind: "commit" }, { date: "2026-11-02", kind: "push" }] },
    { name: "Beta", activity: [{ date: "2026-11-02", kind: "commit" }] },
  ] }];
  const source = { months, days: [day("2026-11-01", 1), day("2026-11-02", 1), day("2026-11-03", 0)] };
  const daily = buildMetricSeries(source, "projects", options);
  assert.deepEqual(daily.map(({ value }) => value), [1, 2, 0]);
  assert.equal(metricSummary(daily, "projects").total, 2);
  const monthly = buildMetricSeries(source, "projects", { ...options, group: "month" });
  assert.equal(monthly[0].value, 2);
  assert.deepEqual(monthly[0].projects, ["Alpha", "Beta"]);
});

test("project counts preserve unavailable and partially observed GitHub coverage", () => {
  const points = buildMetricSeries({ days: [day("2026-11-01", null), day("2026-11-02", 0, null)] }, "projects", options);
  assert.deepEqual(points.map(({ value, partial }) => ({ value, partial })), [
    { value: null, partial: false }, { value: 0, partial: true }, { value: null, partial: false },
  ]);
});

test("project event establishes observed activity even without day coverage", () => {
  const points = buildMetricSeries({ months: [{ projects: [{ name: "Alpha", activity: [{ date: "2026-11-01", kind: "commit" }] }] }] }, "projects", options);
  assert.equal(points[0].value, 1);
  assert.equal(points[0].partial, true);
});

test("tokens use monthly observations and preserve missing months and zero", () => {
  const source = { months: [{ month: "2026-09", tokens: 150 }, { month: "2026-11", tokens: 0 }] };
  const points = buildMetricSeries(source, "tokens", { start: "2026-09-01", end: "2026-11-17", group: "month" });
  assert.deepEqual(points.map(({ value }) => value), [150, null, 0]);
  assert.equal(points[2].endDate, "2026-11-17");
  assert.equal(points[2].partial, false);
  assert.equal(metricSummary(points, "tokens").total, 150);
  assert.throws(() => buildMetricSeries(source, "tokens", options), /monthly only/);
});

test("entirely unavailable and empty series have no fabricated total, average, or peak", () => {
  for (const points of [[], buildMetricSeries({}, "pushes", options)]) {
    const summary = metricSummary(points, "pushes");
    assert.equal(summary.total, null);
    assert.equal(summary.average, null);
    assert.equal(summary.peak, null);
    assert.equal(summary.available, 0);
  }
});

test("CSV exports metric amounts with explicit quality and empty unavailable values", () => {
  const points = buildMetricSeries({ days: [day("2026-11-01", 0), day("2026-11-03", 4)] }, "commits", { ...options, group: "week" });
  assert.equal(seriesCsv(points, "commits"), "date,end_date,commits,quality\r\n2026-11-01,2026-11-01,0,available\r\n2026-11-02,2026-11-03,4,partial\r\n");
  assert.match(seriesCsv(buildMetricSeries({}, "agents", options), "agents"), /2026-11-01,2026-11-01,,unavailable/);
  assert.throws(() => seriesCsv([], "=malicious"), /Unknown metric/);
});

test("date validation rejects malformed and impossible dates; reversed ranges are empty", () => {
  for (const start of ["2026-02-30", "2026-13-01", "x", null]) {
    assert.throws(() => buildMetricSeries({}, "commits", { ...options, start }), /calendar date/);
  }
  assert.deepEqual(buildMetricSeries({}, "commits", { ...options, start: "2026-12-01" }), []);
});
