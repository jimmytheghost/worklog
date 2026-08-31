import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { GitHubCollector } from "@agent-dashboard/collector-github";
import { openStorage } from "@agent-dashboard/storage";

import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

async function start(): Promise<void> {
  const config = readConfig();
  if (config.databasePath !== ":memory:") {
    mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  }
  const storage = openStorage({ filename: config.databasePath });
  const app = buildApp({
    logger: { level: config.logLevel },
    sseHeartbeatMs: config.sseHeartbeatMs,
    storage,
    githubCollector: new GitHubCollector(),
    githubSyncOnStart: config.githubSyncOnStart,
    fixtureMode: false,
    timeZone: config.timeZone,
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "shutting down local service");
    await app.close();
    storage.close();
    process.exitCode = 0;
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error, "failed to start local service");
    process.exitCode = 1;
    await app.close();
    storage.close();
  }
}

void start();
