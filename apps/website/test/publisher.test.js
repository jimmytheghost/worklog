import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const publisher = fileURLToPath(new URL("../publish-activity.py", import.meta.url));
test("device publisher preserves optional rolling windows without adding private fields or changing old snapshots", { skip: process.platform === "win32" ? "Remote POSIX installation requires fcntl; covered on macOS/Linux" : false }, () => {
  const python = process.platform === "win32" ? "python" : "python3";
  const script = `
import importlib.util, json, pathlib, subprocess, sys, tempfile
spec = importlib.util.spec_from_file_location("publisher", sys.argv[1])
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
legacy = {"timeZone":"UTC", "generatedAt":"2026-11-17T22:37:00.000Z", "coverage":{"agentsAt":"2026-11-17T22:36:00.000Z", "agentsFrom":"2026-01-01", "commitsAt":None, "pushesAt":None}, "months":[{"month":"2026-11", "tokens":None, "agentDays":[], "projects":[]}]}
assert "rolling24Hours" not in p.device_activity(legacy)
window = {"start":"2026-11-16T22:30:00.000Z", "end":"2026-11-17T22:30:00.000Z", "tokens":0, "tokensKnowledge":"partial", "agents":0, "subagents":None, "agentDays":[{"localDate":"2026-11-17", "agents":1, "subagents":0, "PRIVATE_DAY":"excluded"}], "PRIVATE_WINDOW":"excluded"}
expected = {key: value for key, value in window.items() if key != "PRIVATE_WINDOW"}
expected["agentDays"] = [{key:value for key,value in day.items() if key != "PRIVATE_DAY"} for day in window["agentDays"]]
snapshot = dict(legacy, rolling24Hours=[window], PRIVATE_ACCOUNT="excluded", credentials="excluded")
entry = p.device_activity(snapshot)
assert entry["rolling24Hours"] == [expected]
assert "PRIVATE_ACCOUNT" not in entry and "credentials" not in entry
entry["PRIVATE_ACCOUNT"] = "excluded again"
entry["rolling24Hours"][0]["PRIVATE_WINDOW"] = "excluded again"
entry["rolling24Hours"][0]["agentDays"][0]["PRIVATE_DAY"] = "excluded again"
with tempfile.TemporaryDirectory() as temp:
    root=pathlib.Path(temp); (root/"index.html").write_text("fixture")
    subprocess.run([sys.executable,"-c",p.INSTALL_DEVICE,temp,"test-device"], input=json.dumps(entry), text=True, check=True)
    installed=json.loads((root/"codex-devices.json").read_text())["devices"]["test-device"]
    assert installed["rolling24Hours"] == [expected]
    assert "PRIVATE_ACCOUNT" not in installed
print("Publisher optional rolling window and installation allowlist passed")
`;
  const result = spawnSync(python, ["-c", script, publisher], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /allowlist passed/);
});
