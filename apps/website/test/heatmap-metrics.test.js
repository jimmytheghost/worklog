import assert from "node:assert/strict";
import test from "node:test";
import { heatmapValue, isPartialActivity } from "../src/heatmap-metrics.js";

test("All includes every activity type while Both only combines Git activity", () => {
  const day = { commits: 2, pushes: 3, agents: 5, subagents: 7 };
  assert.equal(heatmapValue(day, "all"), 17);
  assert.equal(heatmapValue(day, "both"), 5);
  for (const metric of ["commits", "pushes", "agents", "subagents"]) {
    assert.equal(heatmapValue(day, metric), day[metric]);
  }
  assert.equal(isPartialActivity(day), false);
});

test("All preserves Codex-only and legacy Git-only activity as partial observations", () => {
  const codex = { commits: null, pushes: null, agents: 0, subagents: 3 };
  const git = { commits: 2, pushes: 1 };
  assert.equal(heatmapValue(codex, "all"), 3);
  assert.equal(heatmapValue(codex, "both"), null);
  assert.equal(heatmapValue(git, "all"), 3);
  assert.equal(isPartialActivity(codex), true);
  assert.equal(isPartialActivity(git), true);
  assert.equal(heatmapValue({ commits: 2, pushes: null }, "both"), null);
});

test("measured zero remains distinct from completely unavailable activity", () => {
  const zero = { commits: 0, pushes: 0, agents: 0, subagents: 0 };
  const missing = { commits: null, pushes: null, agents: null, subagents: null };
  assert.equal(heatmapValue(zero, "all"), 0);
  assert.equal(heatmapValue(zero, "both"), 0);
  assert.equal(heatmapValue(missing, "all"), null);
  assert.equal(heatmapValue({}, "all"), null);
  assert.equal(isPartialActivity(missing), false);
});
