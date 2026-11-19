import { cp, mkdir } from "node:fs/promises";

const output = new URL("./dist/", import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ["index.html", "activity.js", "week-recap.js", "plot-scrollbar.js", "date-ranges.js", "today-range.js", "github-history.js", "heatmap-metrics.js", "metric-explorer.js", "metric-series.js", "metric-explorer.css", "styles.css", "jimmyweber-skull.svg", "preview.png"]) {
  await cp(new URL(`./src/${name}`, import.meta.url), new URL(name, output));
}
