import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("isolated preview uses only local feeds and preserves missing devices", async () => {
  await promisify(execFile)(process.execPath, ["build.mjs"], { cwd: new URL("../", import.meta.url) });
  const directory = await mkdtemp(join(tmpdir(), "worklog-preview-"));
  const child = spawn(process.execPath, ["preview.mjs", "--port", "0", "--feed-dir", directory], {
    cwd: new URL("../", import.meta.url), stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await writeFile(join(directory, "activity.json"), '{"schemaVersion":1,"months":[]}');
    const [output] = await once(child.stdout, "data");
    const base = output.toString().match(/http:\/\/127\.0\.0\.1:\d+\/worklog\//)?.[0];
    assert.ok(base);
    const response = await fetch(base + "activity.json");
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { schemaVersion: 1, months: [] });
    assert.equal((await fetch(base + "codex-devices.json")).status, 404);
    assert.equal((await fetch(base + "activity.json", { method: "HEAD" })).status, 200);
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + "ledger.sqlite")).status, 404);
  } finally {
    child.kill();
    await once(child, "exit");
    await rm(directory, { recursive: true, force: true });
  }
});
