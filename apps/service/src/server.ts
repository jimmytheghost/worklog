import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

async function start(): Promise<void> {
  const config = readConfig();
  const app = buildApp({
    logger: { level: config.logLevel },
    sseHeartbeatMs: config.sseHeartbeatMs,
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "shutting down local service");
    await app.close();
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
  }
}

void start();
