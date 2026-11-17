#!/usr/bin/env python3
"""Send the public Worklog data feed to the web host through an existing SSH alias."""

import argparse
from datetime import datetime
import json
import re
import shlex
import subprocess
from urllib.error import URLError
from urllib.request import urlopen


INSTALL_ACTIVITY = """
import json
import os
from pathlib import Path
import sys
import tempfile

directory = Path(sys.argv[1])
destination = directory / "activity.json"
if not (directory / "index.html").is_file() or destination.is_symlink():
    raise SystemExit("Worklog website is not available at the configured destination")
payload = sys.stdin.buffer.read()
snapshot = json.loads(payload)
if snapshot.get("schemaVersion") != 1 or not snapshot.get("months"):
    raise SystemExit("Worklog export is invalid")
if destination.exists():
    existing = json.loads(destination.read_bytes())
    if snapshot["generatedAt"] <= existing["generatedAt"]:
        sys.exit(0)
with tempfile.NamedTemporaryFile(dir=directory, prefix=".activity-", delete=False) as temporary:
    try:
        temporary.write(payload)
        temporary.flush()
        os.fchmod(temporary.fileno(), 0o644)
        os.replace(temporary.name, destination)
    finally:
        Path(temporary.name).unlink(missing_ok=True)
"""


INSTALL_DEVICE = """
import fcntl
import json
import os
from pathlib import Path
import sys
import tempfile

directory = Path(sys.argv[1])
device = sys.argv[2]
destination = directory / "codex-devices.json"
lock_path = directory / ".codex-devices.lock"
if not (directory / "index.html").is_file() or destination.is_symlink() or lock_path.is_symlink():
    raise SystemExit("Worklog website is not available at the configured destination")
entry = json.load(sys.stdin)
with lock_path.open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    feed = {"schemaVersion": 1, "timeZone": entry["timeZone"], "devices": {}}
    if destination.exists():
        feed = json.loads(destination.read_bytes())
    if feed["schemaVersion"] != 1 or entry["timeZone"] != feed["timeZone"]:
        raise SystemExit("Device reporting timezone must match the existing Worklog feed")
    previous = feed["devices"].get(device)
    if previous and entry["syncedAt"] <= previous["syncedAt"]:
        sys.exit(0)
    feed["devices"][device] = {key: entry[key] for key in ("syncedAt", "agentsFrom", "months")}
    with tempfile.NamedTemporaryFile(dir=directory, prefix=".activity-", delete=False) as temporary:
        try:
            temporary.write(json.dumps(feed, separators=(",", ":")).encode("utf-8"))
            temporary.flush()
            os.fchmod(temporary.fileno(), 0o644)
            os.replace(temporary.name, destination)
        finally:
            Path(temporary.name).unlink(missing_ok=True)
"""


def device_activity(snapshot):
    # Copy the public Codex aggregates explicitly. GitHub activity is already collected by the primary publisher.
    coverage = snapshot["coverage"]
    return {
        "timeZone": snapshot["timeZone"],
        "syncedAt": datetime.fromisoformat(coverage["agentsAt"].replace("Z", "+00:00")).isoformat(timespec="milliseconds"),
        "agentsFrom": coverage["agentsFrom"],
        "months": [
            {
                "month": month["month"],
                "tokens": month["tokens"],
                "agentDays": [
                    {key: day[key] for key in ("localDate", "agents", "subagents")}
                    for day in month["agentDays"]
                ],
            }
            for month in snapshot["months"]
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", help="existing SSH host alias")
    parser.add_argument("directory", help="absolute directory holding the deployed Worklog index.html")
    parser.add_argument("--device", help="publish only Codex aggregates as an additional device (e.g. windows-pc)")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.host):
        parser.error("host must be an SSH alias")
    if not args.directory.startswith("/"):
        parser.error("directory must be absolute")
    if args.device and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.device):
        parser.error("device must be a lowercase slug")

    try:
        with urlopen("http://127.0.0.1:4317/api/website", timeout=30) as response:
            payload = response.read()
    except (URLError, TimeoutError) as error:
        raise SystemExit("The local Worklog export is unavailable; keeping the published data") from error
    snapshot = json.loads(payload)
    coverage = snapshot.get("coverage", {})
    if snapshot.get("schemaVersion") != 1 or not snapshot.get("months") or not coverage.get("agentsAt"):
        raise SystemExit("Worklog needs a successful Codex sync before publishing activity")
    if args.device:
        payload = json.dumps(device_activity(snapshot)).encode("utf-8")
        remote = shlex.join(["python3", "-c", INSTALL_DEVICE, args.directory, args.device])
    elif not coverage.get("commitsAt"):
        raise SystemExit("Worklog needs a successful GitHub and Codex sync before publishing activity")
    else:
        remote = shlex.join(["python3", "-c", INSTALL_ACTIVITY, args.directory])
    subprocess.run(
        ["ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
         "-o", "ConnectTimeout=10", args.host, remote],
        input=payload, check=True, timeout=45,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


if __name__ == "__main__":
    main()
