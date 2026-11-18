const activityKeys = ["commits", "pushes", "agents", "subagents"];

export function heatmapValue(day, metric) {
  if (metric === "both") {
    return day.commits == null || day.pushes == null ? null : day.commits + day.pushes;
  }
  if (metric === "all") {
    const observed = activityKeys.map((key) => day[key]).filter((value) => value != null);
    return observed.length ? observed.reduce((total, value) => total + value, 0) : null;
  }
  return day[metric] ?? null;
}

export function isPartialActivity(day) {
  return activityKeys.some((key) => day[key] == null) && activityKeys.some((key) => day[key] != null);
}
