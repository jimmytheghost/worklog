// Dates in the feed are reporting-calendar dates. UTC arithmetic keeps their
// weekday stable when the visitor is in another time zone.
export function weekOf(date) {
  const cursor = new Date(date + "T00:00:00Z");
  cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  const start = cursor.toISOString().slice(0, 10);
  cursor.setUTCDate(cursor.getUTCDate() + 6);
  return { start, end: cursor.toISOString().slice(0, 10) };
}

export function projectsInPeriod(months, start, end) {
  const projects = new Map();
  for (const month of months) {
    if (month.month < start.slice(0, 7) || month.month > end.slice(0, 7)) continue;
    for (const project of month.projects) {
      for (const row of project.activity) {
        if (row.date < start || row.date > end) continue;
        const activity = projects.get(project.name) ?? [];
        activity.push(row);
        projects.set(project.name, activity);
      }
    }
  }
  return [...projects].map(([name, rows]) => {
    rows.sort((a, b) => (b.occurredAt || b.date).localeCompare(a.occurredAt || a.date));
    return { name, activeDates: [...new Set(rows.map(row => row.date))].sort(), rows };
  }).sort((a, b) => b.activeDates.length - a.activeDates.length || b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}
