import assert from "node:assert/strict";
import test from "node:test";
import { mergeGitHubHistory } from "../src/github-history.js";

const month = "2026-11";
const date = `${month}-16`;
const commit = (name, sha) => ({ date, kind: "commit", url: `https://github.com/${name}/commit/${sha.repeat(40)}` });
const push = (key) => ({ date, kind: "push", key });
const feed = (...projects) => [{ month, projects }];

test("merges commits and individual pushes across devices and repository renames", () => {
  const primary = { name: "owner/current", key: "repo", activity: [commit("owner/current", "a"), push("1")] };
  const companion = { name: "owner/old", key: "repo", activity: [commit("owner/old", "a"), commit("owner/old", "b"), push("1"), push("2")] };
  const fork = { name: "other/current", key: "fork", activity: [commit("other/current", "a")] };
  const [merged, distinct] = mergeGitHubHistory([feed(primary), feed(companion, fork)]).get(month);
  assert.equal(merged.name, primary.name);
  assert.equal(merged.commits, 2);
  assert.equal(merged.pushes, 2);
  assert.equal(distinct.commits, 1);
});

test("retains the largest legacy daily push count without adding overlapping observations", () => {
  const legacy = { name: "owner/repo", activity: [push(), push(), push()] };
  const device = { name: "Owner/Repo", key: "repo", activity: [push("1"), push("2")] };
  assert.equal(mergeGitHubHistory([feed(legacy), feed(device)]).get(month)[0].pushes, 3);
});

test("retains exact timestamps from a later duplicate without increasing Git totals", () => {
  const time = "2026-11-17T05:30:00.000Z";
  const old = { name: "owner/repo", key: "repo", activity: [commit("owner/repo", "a"), push("1")] };
  const current = { name: "owner/repo", key: "repo", activity: [
    { ...commit("owner/repo", "a"), occurredAt: time }, { ...push("1"), occurredAt: time },
  ] };
  for (const sources of [[feed(old), feed(current)], [feed(current), feed(old)]]) {
    const merged = mergeGitHubHistory(sources).get(month)[0];
    assert.equal(merged.commits, 1);
    assert.equal(merged.pushes, 1);
    assert(merged.activity.every(({ occurredAt }) => occurredAt === time));
  }
});

test("malformed duplicate timestamps cannot hide a trustworthy observation", () => {
  const malformed = { name: "owner/repo", activity: [{ ...commit("owner/repo", "a"), occurredAt: "2026-02-30T12:00:00.000Z" }] };
  const exact = { name: "owner/repo", activity: [{ ...commit("owner/repo", "a"), occurredAt: "2026-11-16T12:00:00.000Z" }] };
  assert.equal(mergeGitHubHistory([feed(malformed), feed(exact)]).get(month)[0].activity[0].occurredAt, "2026-11-16T12:00:00.000Z");
});
