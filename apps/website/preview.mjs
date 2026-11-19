import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { parseArgs } from "node:util";

const publicWorklog = "https://www.jimmyweber.com/worklog/";
const feeds = new Set(["activity.json", "codex-devices.json"]);
const dist = new URL("./dist/", import.meta.url);
const assets = new Set((await readdir(dist, { withFileTypes: true }))
  .filter((entry) => entry.isFile()).map((entry) => entry.name));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const { values } = parseArgs({ options: { port: { type: "string", default: "4177" } } });
const port = Number(values.port);
if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port > 65535) {
  throw new Error("Preview port must be between 0 and 65535.");
}

async function serveFeed(name, method, response) {
  const upstream = await fetch(new URL(name, publicWorklog), {
    method,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    response.writeHead(upstream.status === 404 ? 404 : 502).end();
    return;
  }

  const body = method === "GET" ? Buffer.from(await upstream.arrayBuffer()) : undefined;
  const headers = { "Content-Type": "application/json" };
  if (body) headers["Content-Length"] = body.length;
  for (const key of ["etag", "last-modified"]) {
    const value = upstream.headers.get(key);
    if (value) headers[key] = value;
  }
  response.writeHead(200, headers).end(body);
}

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const path = request.url.split("?", 1)[0];
  const prefix = "/worklog/";
  if (!path.startsWith(prefix)) {
    response.writeHead(404).end();
    return;
  }

  const name = path.slice(prefix.length) || "index.html";
  const isFeed = feeds.has(name);
  try {
    if (isFeed) {
      await serveFeed(name, request.method, response);
      return;
    }

    let body;
    if (name === "preview-refresh.js") {
      body = await readFile(new URL(name, import.meta.url));
    } else if (assets.has(name)) {
      body = await readFile(new URL(name, dist));
      if (name === "index.html") {
        body = Buffer.from(body.toString().replace("</head>",
          '<script type="module" src="./preview-refresh.js"></script>\n</head>'));
      }
    } else {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(name)] ?? "application/octet-stream",
      "Content-Length": body.length,
    }).end(request.method === "GET" ? body : undefined);
  } catch {
    response.writeHead(isFeed ? 502 : 500).end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Worklog preview: http://127.0.0.1:${server.address().port}/worklog/`);
});
