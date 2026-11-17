#!/usr/bin/env python3
"""Send the public Worklog data feed to the web host through an existing SSH alias."""

import argparse
from hashlib import sha256
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
    if previous and entry["generatedAt"] <= previous.get("generatedAt", ""):
        sys.exit(0)
    feed["devices"][device] = {key: entry[key] for key in ("generatedAt", "syncedAt", "agentsFrom", "months", "git")}
    with tempfile.NamedTemporaryFile(dir=directory, prefix=".activity-", delete=False) as temporary:
        try:
            temporary.write(json.dumps(feed, separators=(",", ":")).encode("utf-8"))
            temporary.flush()
            os.fchmod(temporary.fileno(), 0o644)
            os.replace(temporary.name, destination)
        finally:
            Path(temporary.name).unlink(missing_ok=True)
"""


def read_local(path):
    with urlopen(f"http://127.0.0.1:4317{path}", timeout=30) as response:
        return json.load(response)


def github_digest(value):
    return sha256(value.encode("utf-8")).hexdigest()


def add_github_keys(snapshot):
    # Both routes sort the same ledger events by instant and ID. Check the ordered
    # event types and commit SHAs before pairing pushes from the two projections.
    def signature(kind, url):
        return (kind, url.rsplit("/", 1)[-1].lower()) if kind == "commit" and url else (kind, None)

    for month in snapshot["months"]:
        if not month["projects"]:
            continue
        try:
            history = read_local(f"/api/history?month={month['month']}")
        except (URLError, TimeoutError):
            continue  # Preserve the public rows if history is temporarily unavailable.
        by_name = {f"{p['owner']}/{p['name']}" if p["owner"] else p["name"]: p for p in history["projects"]}
        for project in month["projects"]:
            detail = by_name.get(project["name"])
            if not detail:
                continue
            project["key"] = github_digest(detail["projectId"])
            public_rows = project["activity"]
            local_rows = detail["activity"]
            if [signature(row["kind"], row.get("url")) for row in public_rows] != [
                signature(row["type"], row.get("url")) for row in local_rows
            ]:
                continue
            for row, local in zip(public_rows, local_rows):
                if row["kind"] == "push" and re.fullmatch(r"github\.push:\d+:\d+:\d+:activity:.+", local["id"]):
                    row["key"] = github_digest(local["id"])


def device_activity(snapshot):
    coverage = snapshot["coverage"]
    return {
        "timeZone": snapshot["timeZone"],
        "generatedAt": snapshot["generatedAt"],
        "syncedAt": coverage.get("agentsAt"),
        "agentsFrom": coverage["agentsFrom"],
        "git": {
            "commitsAt": coverage.get("commitsAt"),
            "pushesAt": coverage.get("pushesAt"),
            "months": [{"month": month["month"], "projects": month["projects"]} for month in snapshot["months"]],
        },
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
    parser.add_argument("--device", help="publish GitHub history and Codex totals for an additional device (e.g. windows-pc)")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.host):
        parser.error("host must be an SSH alias")
    if not args.directory.startswith("/"):
        parser.error("directory must be absolute")
    if args.device and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.device):
        parser.error("device must be a lowercase slug")

    try:
        snapshot = read_local("/api/website")
    except (URLError, TimeoutError) as error:
        raise SystemExit("The local Worklog export is unavailable; keeping the published data") from error
    coverage = snapshot.get("coverage", {})
    if snapshot.get("schemaVersion") != 1 or not snapshot.get("months"):
        raise SystemExit("Worklog export is invalid")
    add_github_keys(snapshot)
    if args.device:
        if not any(coverage.get(key) for key in ("agentsAt", "commitsAt", "pushesAt")):
            raise SystemExit("Worklog needs a successful GitHub or Codex sync before publishing activity")
        payload = json.dumps(device_activity(snapshot)).encode("utf-8")
        remote = shlex.join(["python3", "-c", INSTALL_DEVICE, args.directory, args.device])
    elif not coverage.get("commitsAt") or not coverage.get("agentsAt"):
        raise SystemExit("Worklog needs a successful GitHub and Codex sync before publishing activity")
    else:
        payload = json.dumps(snapshot).encode("utf-8")
        remote = shlex.join(["python3", "-c", INSTALL_ACTIVITY, args.directory])
    subprocess.run(
        ["ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
         "-o", "ConnectTimeout=10", args.host, remote],
        input=payload, check=True, timeout=45,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


if __name__ == "__main__":
    main()
