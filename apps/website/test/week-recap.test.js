import test from "node:test";
import assert from "node:assert/strict";
import { weekOf, projectsInPeriod, tokenRecap } from "../src/week-recap.js";

test("a selected week's project cards cross months and keep push-only work", () => {
  const week = weekOf("2026-11-01");
  assert.deepEqual(week, { start: "2026-10-26", end: "2026-11-01" });
  const months = [["2026-10", "2026-10-31", "commit"], ["2026-11", "2026-11-01", "push"]]
    .map(([month, date, kind]) => ({ month, projects: [{ name: "Worklog", activity: [{ date, kind }] }] }));
  const [project] = projectsInPeriod(months, week.start, week.end);
  assert.deepEqual(project.activeDates, ["2026-10-31", "2026-11-01"]);
  assert.deepEqual(project.rows.map(row => row.kind), ["push", "commit"]);
  assert.equal(projectsInPeriod(months, week.end, week.end)[0].rows.length, 1);
});


test("weekly observed tokens keep missing dates, partial counters and measured zero distinct", () => {
  const days = [
    {date: "2026-10-31", tokens: 0, tokensKnowledge: "complete"},
    {date: "2026-11-01", tokens: 24, tokensKnowledge: "partial"},
    {date: "2026-11-02", tokens: 100, tokensKnowledge: "complete"},
  ];
  assert.deepEqual(tokenRecap(days, "2026-10-26", "2026-11-01"), {tokens: 24, measuredDays: 2, totalDays: 7, tokensKnowledge: "partial"});
  assert.deepEqual(tokenRecap(days, "2026-10-31", "2026-10-31"), {tokens: 0, measuredDays: 1, totalDays: 1, tokensKnowledge: "complete"});
  assert.deepEqual(tokenRecap(days, "2026-10-30", "2026-10-30"), {tokens: null, measuredDays: 0, totalDays: 1, tokensKnowledge: "unknown"});
});
