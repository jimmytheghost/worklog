import assert from "node:assert/strict";
import test from "node:test";
import { mergeTokenDays, tokenDaySources, resolveRange, selectRange, validDate } from "../src/date-ranges.js";

const earliest = "2025-01-01", latest = "2026-11-17";
test("presets use inclusive reporting dates across years and leap days", () => {
  assert.deepEqual(resolveRange("7", earliest, latest), { start: "2026-11-11", end: latest });
  assert.deepEqual(resolveRange("30", earliest, latest), { start: "2026-10-19", end: latest });
  assert.deepEqual(resolveRange("90", earliest, latest), { start: "2026-08-20", end: latest });
  assert.deepEqual(resolveRange("year", earliest, latest), { start: "2026-01-01", end: latest });
  assert.equal(resolveRange("7", "2024-01-01", "2024-03-01").start, "2024-02-24");
  assert.equal(resolveRange("30", "2026-11-01", latest).start, "2026-11-01");
  assert.deepEqual(resolveRange("2026-02", earliest, latest), { start: "2026-02-01", end: "2026-02-28" });
  assert.equal(resolveRange("2026-11", earliest, latest).end, latest);
});
test("custom ranges reject missing, reversed, impossible and out-of-coverage dates", () => {
  for (const [start, end] of [["", latest], [latest, "2026-11-01"], ["2026-02-30", latest], ["2024-12-31", latest], [earliest, "2026-11-18"]]) {
    assert.throws(() => resolveRange("custom", earliest, latest, start, end), RangeError);
  }
  assert.throws(() => resolveRange("2029-01", earliest, latest), RangeError);
  assert.throws(() => resolveRange("2024-01", earliest, latest), RangeError);
  assert.equal(validDate("2026-02-29"), false);
  assert.deepEqual(resolveRange("custom", earliest, latest, latest, latest), { start: latest, end: latest });
});
const months = [{ month: "2026-10", tokens: 100, projects: [{ name: "repo", activity: [
  { date: "2026-10-01", kind: "commit" }, { date: "2026-10-31", kind: "push" },
] }] }, { month: "2026-11", tokens: 50, projects: [] }];
const days = [{ date: "2026-10-31", commits: 0, pushes: 1, agents: null, subagents: null }];
test("filters event counts and retains zero, missing days, and unavailable observations", () => {
  const result = selectRange(months, days, { start: "2026-10-31", end: "2026-11-01" }, latest);
  assert.equal(result.months[0].projects[0].commits, 0);
  assert.equal(result.months[0].projects[0].pushes, 1);
  assert.equal(result.months[0].projects[0].activity.length, 1);
  assert.equal(result.days[1].commits, null);
  assert.deepEqual(result.totals, { commits: 0, pushes: 1, agents: null, subagents: null });
  assert.equal(result.tokens, null);
  assert.equal(selectRange(months, days, { start: "2026-10-02", end: "2026-10-02" }, latest).months[0].projects.length, 0);
});
test("tokens require complete reporting months, including the current month through its latest report", () => {
  assert.equal(selectRange(months, days, { start: "2026-10-01", end: latest }, latest).tokens, 150);
  assert.equal(selectRange(months, days, { start: "2026-10-01", end: "2026-10-31" }, latest).tokens, 100);
  assert.equal(selectRange(months, days, { start: "2026-11-01", end: latest }, latest).tokens, 50);
  assert.equal(selectRange(months, days, { start: "2026-10-02", end: latest }, latest).tokens, null);
  assert.equal(selectRange(months, days, { start: "2026-10-01", end: "2026-10-30" }, latest).tokens, null);
});

test("calendar Today has one date, and a mixed-version device contributes unknown daily coverage", () => {
  assert.deepEqual(resolveRange("today", earliest, latest), {start: latest, end: latest});
  const source = [{month: "2026-11", tokenDays: [
    {localDate: latest, tokens: 0, tokensKnowledge: "complete"},
    {localDate: "2026-11-16", tokens: 19, tokensKnowledge: "partial"},
  ]}];
  assert.equal(mergeTokenDays([months]), null);
  const mixed = mergeTokenDays([source, months]);
  assert.deepEqual(mixed.get(latest), {tokens: 0, tokensKnowledge: "partial"});
  const days = [...mixed].map(([date, day]) => ({date, ...day}));
  const selection = selectRange(months, days, {start: "2026-11-16", end: latest}, latest);
  assert.equal(selection.tokens, 19);
  assert.deepEqual(selection.partialMetrics, ["tokens"]);
  assert.deepEqual(mergeTokenDays([source, source]).get(latest), {tokens: 0, tokensKnowledge: "complete"});
});


test("missing expected Windows and failed device feeds retain incomplete combined daily coverage", () => {
  const primary = [{month: "2026-11", tokenDays: [{localDate: latest, tokens: 0, tokensKnowledge: "complete"}]}];
  const windows = ["windows-pc", {months: primary}];
  assert.equal(mergeTokenDays(tokenDaySources(primary, [])).get(latest).tokensKnowledge, "partial");
  assert.equal(mergeTokenDays(tokenDaySources(primary, [windows])).get(latest).tokensKnowledge, "complete");
  assert.equal(mergeTokenDays(tokenDaySources(primary, [windows], false)).get(latest).tokensKnowledge, "partial");
  assert.equal(mergeTokenDays(tokenDaySources(primary, [["mac-mini", {months: primary}]] )).get(latest).tokensKnowledge, "partial");
});
