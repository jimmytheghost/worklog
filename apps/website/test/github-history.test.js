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
