import type { CodexCollector } from "@agent-dashboard/collector-codex";
import type { GitHubCollector } from "@agent-dashboard/collector-github";
import type { Storage } from "@agent-dashboard/storage";
import Fastify, { type FastifyInstance } from "fastify";

import { ServiceEventHub } from "./events.js";
import { CodexSyncCoordinator } from "./codex-sync.js";
import { snapshotFixture } from "./fixtures/snapshot.js";
import { GitHubSyncCoordinator } from "./github-sync.js";
import { buildStorageSnapshot } from "./snapshot.js";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

type BuildAppOptions = {
  logger?: false | { level: LogLevel };
  sseHeartbeatMs?: number;
  /** Allows a bounded stream in tests without changing the public endpoint contract. */
  sseMaxHeartbeats?: number;
  storage?: Storage;
  githubCollector?: Pick<GitHubCollector, "collect">;
  codexCollector?: Pick<CodexCollector, "collect">;
  eventHub?: ServiceEventHub;
  fixtureMode?: boolean;
  githubSyncOnStart?: boolean;
  codexSyncOnStart?: boolean;
  timeZone?: string;
  now?: () => Date;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const eventHub = options.eventHub ?? new ServiceEventHub();
  const now = options.now ?? (() => new Date());
  const fixtureMode = options.fixtureMode ?? options.storage === undefined;
  const githubCoordinator =
    options.storage !== undefined && options.githubCollector !== undefined
      ? new GitHubSyncCoordinator(options.storage, options.githubCollector, eventHub, now)
      : undefined;
  const codexCoordinator =
    options.storage !== undefined && options.codexCollector !== undefined
      ? new CodexSyncCoordinator(options.storage, options.codexCollector, eventHub, now)
      : undefined;

  app.get("/health", async () => ({
    status: "ok",
    service: "@agent-dashboard/service",
    version: "0.0.0",
    now: now().toISOString(),
    githubSync: githubCoordinator?.state.status ?? "disabled",
    codexSync: codexCoordinator?.state.status ?? "disabled",
  }));

  app.get("/api/snapshot", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    if (fixtureMode) return snapshotFixture;
    if (options.storage === undefined) {
      return reply.code(503).send({ error: "Storage is unavailable" });
    }
    return buildStorageSnapshot(options.storage, {
      timeZone: options.timeZone ?? "America/Denver",
      now: now(),
    });
  });

  app.post("/api/sync/github", async (_request, reply) => {
    if (githubCoordinator === undefined) {
      return reply.code(503).send({
        status: "unavailable",
        error: "GitHub synchronization is not configured",
      });
    }

    const state = await githubCoordinator.sync();
    return reply.code(state.status === "failed" ? 503 : 200).send(state);
  });

  app.post("/api/sync/codex", async (_request, reply) => {
    if (codexCoordinator === undefined) {
      return reply.code(503).send({
        status: "unavailable",
        error: "Codex synchronization is not configured",
      });
    }

    const state = await codexCoordinator.sync();
    return reply.code(state.status === "failed" ? 503 : 200).send(state);
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
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    writeEvent("connected", {
      schemaVersion: 1,
      connectedAt: now().toISOString(),
      githubSync: githubCoordinator?.state ?? { status: "disabled" },
      codexSync: codexCoordinator?.state ?? { status: "disabled" },
    });

    const unsubscribe = eventHub.subscribe(({ event, data }) => writeEvent(event, data));
    let heartbeatCount = 0;
    const heartbeat = setInterval(() => {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        cleanup();
        return;
      }

      heartbeatCount += 1;
      writeEvent("heartbeat", {
        sequence: heartbeatCount,
        sentAt: now().toISOString(),
      });

      if (
        options.sseMaxHeartbeats !== undefined &&
        heartbeatCount >= options.sseMaxHeartbeats
      ) {
        cleanup();
        reply.raw.end();
      }
    }, options.sseHeartbeatMs ?? 15_000);

    function cleanup() {
      clearInterval(heartbeat);
      unsubscribe();
    }

    reply.raw.once("close", cleanup);
    reply.raw.once("error", cleanup);
  });

  if (options.githubSyncOnStart === true && githubCoordinator !== undefined) {
    app.addHook("onReady", async () => {
      const state = await githubCoordinator.sync();
      if (state.status === "failed") {
        app.log.warn({ code: state.error?.code }, "GitHub synchronization on start failed");
      }
    });
  }

  if (options.codexSyncOnStart === true && codexCoordinator !== undefined) {
    app.addHook("onReady", async () => {
      const state = await codexCoordinator.sync();
      if (state.status === "failed") {
        app.log.warn({ code: state.error?.code }, "Codex synchronization on start failed");
      }
    });
  }

  return app;
}
