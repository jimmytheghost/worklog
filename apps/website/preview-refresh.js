const feeds = ["activity.json", "codex-devices.json"];
let versions;
let checking = false;

async function feedVersion(name) {
  try {
    const response = await fetch(new URL(name, import.meta.url), {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (name === "codex-devices.json" && response.status === 404) return "absent";
    if (response.ok) return response.headers.get("etag") || response.headers.get("last-modified");
  } catch {
    // Keep the currently rendered report during connection failures.
  }
  return null;
}

async function refreshIfUpdated() {
  if (checking || document.hidden) return;
  checking = true;
  try {
    const latest = await Promise.all(feeds.map(feedVersion));
    if (versions && latest.some((version, index) => version !== null && version !== versions[index])) {
      if (document.hidden || document.activeElement?.matches("input, select, textarea")) return;
      location.reload();
    }
    versions = latest.map((version, index) => version ?? versions?.[index]);
  } finally {
    checking = false;
  }
}

setInterval(refreshIfUpdated, 60_000);
document.addEventListener("visibilitychange", refreshIfUpdated);
refreshIfUpdated();
