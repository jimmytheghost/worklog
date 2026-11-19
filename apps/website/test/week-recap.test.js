import test from "node:test";
import assert from "node:assert/strict";
import { weekOf, projectsInPeriod } from "../src/week-recap.js";

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
