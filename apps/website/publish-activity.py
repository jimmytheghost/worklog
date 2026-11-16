#!/usr/bin/env python3
"""Send the public Worklog data feed to the web host through an existing SSH alias."""

import argparse
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", help="existing SSH host alias")
    parser.add_argument("directory", help="absolute directory holding the deployed Worklog index.html")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.host):
        parser.error("host must be an SSH alias")
    if not args.directory.startswith("/"):
        parser.error("directory must be absolute")

    try:
        with urlopen("http://127.0.0.1:4317/api/website", timeout=30) as response:
            payload = response.read()
    except (URLError, TimeoutError) as error:
        raise SystemExit("The local Worklog export is unavailable; keeping the published data") from error
    snapshot = json.loads(payload)
    coverage = snapshot.get("coverage", {})
    if snapshot.get("schemaVersion") != 1 or not snapshot.get("months") or not coverage.get("commitsAt") or not coverage.get("agentsAt"):
        raise SystemExit("Worklog needs a successful GitHub and Codex sync before publishing activity")
    remote = shlex.join(["python3", "-c", INSTALL_ACTIVITY, args.directory])
    subprocess.run(
        ["ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
         "-o", "ConnectTimeout=10", args.host, remote],
        input=payload, check=True, timeout=45,
    )


if __name__ == "__main__":
    main()
