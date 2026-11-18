import assert from "node:assert/strict";
import test from "node:test";
import { selectToday } from "../src/today-range.js";

const end = "2026-11-18T05:30:00.000Z";
const generatedAt = "2026-11-18T05:35:00.000Z";
const start = "2026-11-17T05:30:00.000Z";
const window = (overrides = {}) => ({ start, end, tokens: 0, tokensKnowledge: "complete", agents: 0, subagents: 0, agentDays: [], ...overrides });
const primary = (windows = [window()], extra = {}) => ({ generatedAt, rolling24Hours: windows,
  coverage: { commitsAt: end, pushesAt: end }, months: [], ...extra });
const device = (windows = [window()], extra = {}) => ({ generatedAt, rolling24Hours: windows,
  git: { commitsAt: end, pushesAt: end, months: [] }, ...extra });
const row = (occurredAt, kind = "commit", date = "2026-11-17") => ({ occurredAt, kind, date, subject: "Observed work" });
const months = (activity, name = "owner/project") => [{ month: "2026-11", projects: [{ name, activity }] }];
const select = (activity = [], feed = primary(), devices = []) => selectToday(months(activity), feed, devices, "America/Denver");

test("Today selects the exact half-open interval and reporting-zone dates, not two whole days", () => {
  const result = select([row("2026-11-17T05:29:59.999Z"), row(start), row("2026-11-18T05:29:59.999Z", "push"), row(end)]);
  assert.deepEqual(result.bounds, { start: "2026-11-16", end: "2026-11-17", startAt: start, endAt: end, mode: "today" });
  assert.deepEqual(result.totals, { commits: 1, pushes: 1, agents: 0, subagents: 0 });
  assert.deepEqual(result.days.map(({ date, commits, pushes }) => ({ date, commits, pushes })), [
    { date: "2026-11-16", commits: 1, pushes: 0 }, { date: "2026-11-17", commits: 0, pushes: 1 },
  ]);
  assert.equal(result.months[0].projects[0].activity.length, 2);
  assert.equal(result.partialMetrics.length, 0);
});

test("multiple devices use the latest common aligned window", () => {
  const earlierEnd = "2026-11-18T05:15:00.000Z", earlierStart = "2026-11-17T05:15:00.000Z";
  const first = window({ tokens: 100 });
  const shared = window({ start: earlierStart, end: earlierEnd, tokens: 10, agents: 1, agentDays: [{ localDate: "2026-11-17", agents: 1, subagents: 0 }] });
  const companion = window({ ...shared, tokens: 20, agents: 2, agentDays: [{ localDate: "2026-11-17", agents: 2, subagents: 0 }] });
  const result = select([], primary([first, shared]), [["windows-pc", device([companion], { generatedAt: "2026-11-18T05:23:00.000Z" })]]);
  assert.equal(result.bounds.endAt, earlierEnd);
  assert.equal(result.tokens, 30);
  assert.equal(result.tokensKnowledge, "complete");
  assert.equal(result.totals.agents, 3);
  assert.equal(result.days.find(({ date }) => date === "2026-11-17").agents, 3);
});

test("legacy or stale devices cannot be silently counted as zero", () => {
  for (const companion of [device([], { rolling24Hours: undefined }), device([window({ start: "2026-11-17T04:30:00.000Z", end: "2026-11-18T04:30:00.000Z", tokens: 500 })], { generatedAt: "2026-11-18T04:35:00.000Z" })]) {
    const result = select([], primary([window({ tokens: 10 })]), [["windows-pc", companion]]);
    assert.equal(result.tokens, 10);
    assert.equal(result.tokensKnowledge, "partial");
    assert.deepEqual(result.missingDevices, ["windows-pc"]);
    assert(result.partialMetrics.includes("tokens"));
    assert(result.partialMetrics.includes("agents"));
  }
});

test("known zero, wholly unknown, and partially known counters stay different", () => {
  const zero = select();
  assert.equal(zero.tokens, 0);
  assert.equal(zero.tokensKnowledge, "complete");
  assert.equal(zero.totals.agents, 0);
  const unknown = select([], primary([window({ tokens: null, tokensKnowledge: "unknown", agents: null, subagents: null })]));
  assert.equal(unknown.tokens, null);
  assert.equal(unknown.tokensKnowledge, "unknown");
  assert.equal(unknown.totals.agents, null);
  assert(unknown.days.every(({ agents }) => agents === null));
  const partial = select([], primary([window({ tokens: 15, tokensKnowledge: "partial" })]), [["windows-pc", device([window({ tokens: null, tokensKnowledge: "unknown" })])]]);
  assert.equal(partial.tokens, 15);
  assert.equal(partial.tokensKnowledge, "partial");
});

test("date-only Git activity is excluded and marked partial; precise event time determines its local date", () => {
  const result = select([{ kind: "commit", date: "2026-11-17" }, row("bad", "push"), row(start, "commit", "2026-11-18")]);
  assert.equal(result.totals.commits, 1);
  assert.equal(result.totals.pushes, 0);
  assert(result.partialMetrics.includes("commits"));
  assert(result.partialMetrics.includes("pushes"));
  assert(result.days.every(({ partialMetrics }) => partialMetrics.includes("commits")));
  assert.equal(result.months[0].projects[0].activity[0].date, "2026-11-16");
});

test("missing or stale Git coverage qualifies observed subtotals", () => {
  const unknown = select([], primary([window()], { coverage: {} }));
  assert.equal(unknown.totals.commits, null);
  assert.equal(unknown.projectCount, null);
  assert(unknown.days.every(({ commits }) => commits === null));
  const observed = select([row(start)], primary([window()], { coverage: {} }));
  assert.equal(observed.totals.commits, 1);
  assert(observed.partialMetrics.includes("commits"));
  const stale = select([], primary([window()], { coverage: { commitsAt: "2026-11-17T05:30:00.000Z", pushesAt: end } }));
  assert.equal(stale.totals.commits, 0);
  assert(stale.partialMetrics.includes("commits"));
});

test("all absent windows produce unknowns and a usable fallback interval", () => {
  const result = select([], primary([], { rolling24Hours: undefined }), [["windows-pc", device([])]]);
  assert.equal(result.bounds.endAt, end);
  assert.equal(result.tokens, null);
  assert.equal(result.totals.commits, null);
  assert.equal(result.months.length, 0);
  assert.deepEqual(result.missingDevices, ["primary", "windows-pc"]);
  assert.match(result.reason, /unavailable/);
});

test("unsupported or ambiguous windows fail closed", () => {
  for (const bad of [
    window({ start: "2026-11-17T05:31:00.000Z" }),
    window({ end: "2026-11-18T05:29:00.000Z", start: "2026-11-17T05:29:00.000Z" }),
    window({ start: "2026-02-30T05:30:00.000Z" }),
    window({ start: "2026-11-17T04:30:00.000Z", end: "2026-11-18T04:30:00.000Z" }),
    window({ end: "2026-11-18T05:45:00.000Z", start: "2026-11-17T05:45:00.000Z" }),
  ]) {
    assert.equal(select([], primary([bad])).tokens, null);
  }
  assert.equal(select([], primary([window(), window()])).tokens, null);
  const different = window({ start: "2026-11-17T05:15:00.000Z", end: "2026-11-18T05:15:00.000Z" });
  const result = select([], primary(), [["windows-pc", device([different])]]);
  assert.equal(result.tokens, null);
  assert.match(result.reason, /shared/);
});

test("invalid or incomplete agent-day distributions do not invent daily zeroes", () => {
  const result = select([], primary([window({ agents: 4, agentDays: [{ localDate: "2026-99-99", agents: 4, subagents: 0 }] })]));
  assert.equal(result.totals.agents, 4);
  assert(result.days.every(({ agents }) => agents === null));
  assert(result.partialMetrics.includes("agents"));
});

test("a 24-hour interval stays exact through the fall DST transition", () => {
  const dstEnd = "2026-11-02T06:30:00.000Z", dstStart = "2026-11-01T06:30:00.000Z";
  const feed = primary([window({ start: dstStart, end: dstEnd })], { generatedAt: "2026-11-02T06:35:00.000Z", coverage: { commitsAt: dstEnd, pushesAt: dstEnd } });
  const result = select([row("2026-11-01T06:29:59.999Z"), row(dstStart), row("2026-11-02T06:29:59.999Z")], feed);
  assert.equal(Date.parse(result.bounds.endAt) - Date.parse(result.bounds.startAt), 86_400_000);
  assert.equal(result.bounds.start, "2026-11-01");
  assert.equal(result.bounds.end, "2026-11-01");
  assert.equal(result.days.length, 1);
  assert.equal(result.totals.commits, 2);
});

test("filtered project activity preserves distinct repositories and excludes out-of-window projects", () => {
  const source = [
    ...months([row(start), row(end)], "owner/first"),
    ...months([row(start, "push")], "owner/second"),
    ...months([row(end)], "owner/outside"),
  ];
  const result = selectToday(source, primary(), [], "America/Denver");
  assert.deepEqual(result.months[0].projects.map(({ name }) => name), ["owner/first", "owner/second"]);
  assert.equal(result.months[0].tokens, null);
  assert.equal(result.projectCount, 2);
});
