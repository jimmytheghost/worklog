import { cp, mkdir } from "node:fs/promises";

const output = new URL("./dist/", import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ["index.html", "activity.js", "github-history.js", "styles.css", "preview.png"]) {
  await cp(new URL(`./src/${name}`, import.meta.url), new URL(name, output));
}
