const commitSha = /\/commit\/([0-9a-f]{40,64})$/i;

export function mergeGitHubHistory(sources) {
  const names = new Map();
  const keysByName = new Map();
  for (const months of sources) {
    for (const { projects } of months) {
      for (const { key, name } of projects) {
        if (key && !names.has(key)) names.set(key, name);
        if (key && !keysByName.has(name.toLowerCase())) keysByName.set(name.toLowerCase(), key);
      }
    }
  }

  const repositories = new Map();
  for (const months of sources) {
    for (const { projects } of months) {
      for (const project of projects) {
        const slug = project.name.toLowerCase();
        const key = project.key ?? keysByName.get(slug) ?? slug;
        const name = names.get(key) ?? project.name;
        const repo = repositories.get(key) ?? { name, commits: new Map(), days: new Map(), pushDates: new Map() };
        repositories.set(key, repo);
        const counts = new Map();
        for (const row of project.activity) {
          const sha = row.kind === "commit" && commitSha.exec(row.url ?? "")?.[1].toLowerCase();
          if (sha) {
            if (!repo.commits.has(sha)) repo.commits.set(sha, row);
            continue;
          }
          const bucket = `${row.date}:${row.kind}`;
          if (row.key) {
            const previous = repo.pushDates.get(row.key);
            if (previous && previous !== bucket) continue;
            repo.pushDates.set(row.key, bucket);
          }
          const day = repo.days.get(bucket) ?? { identified: new Map(), largest: [] };
          repo.days.set(bucket, day);
          if (row.key && !day.identified.has(row.key)) day.identified.set(row.key, row);
          const rows = counts.get(bucket) ?? [];
          rows.push(row);
          counts.set(bucket, rows);
        }
        for (const [bucket, rows] of counts) {
          const day = repo.days.get(bucket);
          if (rows.length > day.largest.length) day.largest = rows;
        }
      }
    }
  }

  const byMonth = new Map();
  for (const { name, commits, days } of repositories.values()) {
    const activity = [...commits.values()];
    for (const { identified, largest } of days.values()) {
      activity.push(...identified.values());
      // Older exports may only provide daily multiplicity. Preserve that lower
      // bound without assuming that unidentified rows represent extra pushes.
      const missing = Math.max(0, largest.length - identified.size);
      activity.push(...largest.filter((row) => !row.key).slice(0, missing));
    }
    const projectMonths = new Map();
    for (const row of activity.sort((a, b) => b.date.localeCompare(a.date))) {
      const month = row.date.slice(0, 7);
      const project = projectMonths.get(month) ?? { name, commits: 0, pushes: 0, activity: [] };
      if (row.kind === "commit") project.commits++;
      else project.pushes++;
      project.activity.push(row);
      projectMonths.set(month, project);
    }
    for (const [month, project] of projectMonths) {
      const projects = byMonth.get(month) ?? [];
      projects.push(project);
      byMonth.set(month, projects);
    }
  }
  return byMonth;
}
