import Fastify, { type FastifyInstance } from "fastify";

import { snapshotFixture } from "./fixtures/snapshot.js";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

type BuildAppOptions = {
  logger?: false | { level: LogLevel };
  sseHeartbeatMs?: number;
  /** Allows a bounded stream in tests without changing the public endpoint contract. */
  sseMaxHeartbeats?: number;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "@agent-dashboard/service",
    version: "0.0.0",
    now: new Date().toISOString(),
  }));

  app.get("/api/snapshot", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return snapshotFixture;
  });

  app.get("/api/events", async (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });

    const writeEvent = (event: string, data: Record<string, unknown>) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    writeEvent("connected", {
      schemaVersion: 1,
      connectedAt: new Date().toISOString(),
    });

    let heartbeatCount = 0;
    const heartbeat = setInterval(() => {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        clearInterval(heartbeat);
        return;
      }

      heartbeatCount += 1;
      writeEvent("heartbeat", {
        sequence: heartbeatCount,
        sentAt: new Date().toISOString(),
      });

      if (
        options.sseMaxHeartbeats !== undefined &&
        heartbeatCount >= options.sseMaxHeartbeats
      ) {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    }, options.sseHeartbeatMs ?? 15_000);

    const cleanup = () => clearInterval(heartbeat);
    reply.raw.once("close", cleanup);
    reply.raw.once("error", cleanup);
  });

  return app;
}
