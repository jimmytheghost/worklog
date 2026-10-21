import type { CodexAccountCollector, CodexCollector } from "@agent-dashboard/collector-codex";
import type { GitHubCollector } from "@agent-dashboard/collector-github";
import type { Storage } from "@agent-dashboard/storage";
import Fastify, { type FastifyInstance } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

import { ServiceEventHub } from "./events.js";
import { CodexAccountSyncCoordinator } from "./codex-account-sync.js";
import { CodexSyncCoordinator } from "./codex-sync.js";
import { snapshotFixture } from "./fixtures/snapshot.js";
import { GitHubSyncCoordinator } from "./github-sync.js";
import { buildMonthlyHistory } from "./history.js";
import { buildPeriodSummary, PERIODS, type SummaryPeriod } from "./period-summary.js";
import { buildStorageSnapshot } from "./snapshot.js";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

type BuildAppOptions = {
  logger?: false | { level: LogLevel };
  dashboardPath?: string;
  sseHeartbeatMs?: number;
  /** Allows a bounded stream in tests without changing the public endpoint contract. */
  sseMaxHeartbeats?: number;
  storage?: Storage;
  githubCollector?: Pick<GitHubCollector, "collect">;
  codexCollector?: Pick<CodexCollector, "collect">;
  codexAccountCollector?: Pick<CodexAccountCollector, "collect">;
  eventHub?: ServiceEventHub;
  fixtureMode?: boolean;
  githubSyncOnStart?: boolean;
  codexSyncOnStart?: boolean;
  githubSyncIntervalMs?: number;
  codexSyncIntervalMs?: number;
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
  const codexAccountCoordinator =
    options.storage !== undefined && options.codexAccountCollector !== undefined
      ? new CodexAccountSyncCoordinator(options.storage, options.codexAccountCollector, eventHub, now)
      : undefined;

  const scheduledRefreshes: NodeJS.Timeout[] = [];
  const activeEventStreams = new Set<ServerResponse>();

  app.get("/health", async () => ({
    status: "ok",
    service: "@agent-dashboard/service",
    version: "0.0.0",
    now: now().toISOString(),
    githubSync: githubCoordinator?.state.status ?? "disabled",
    codexSync: codexCoordinator?.state.status ?? "disabled",
    codexAccountSync: codexAccountCoordinator?.state.status ?? "disabled",
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

  app.get<{ Querystring: { month?: string } }>("/api/history", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (fixtureMode || options.storage === undefined) {
      return reply.code(503).send({ error: "Work history is unavailable" });
    }
    const month = request.query.month;
    if (month === undefined) {
      return reply.code(400).send({ error: "month must use YYYY-MM" });
    }
    try {
      return buildMonthlyHistory(options.storage, {
        month,
        timeZone: options.timeZone ?? "America/Denver",
      });
    } catch (error) {
      if (error instanceof RangeError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get<{ Querystring: { period?: string } }>("/api/summary", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (fixtureMode || options.storage === undefined) {
      return reply.code(503).send({ error: "Period summary is unavailable" });
    }
    const period = request.query.period;
    if (period === undefined || !PERIODS.includes(period as SummaryPeriod)) {
      return reply.code(400).send({ error: "period must be day, week, month, year, or all" });
    }
    return buildPeriodSummary(options.storage, {
      period: period as SummaryPeriod,
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
    if (codexCoordinator === undefined && codexAccountCoordinator === undefined) {
      return reply.code(503).send({
        status: "unavailable",
        error: "Codex synchronization is not configured",
      });
    }

    if (codexAccountCoordinator === undefined && codexCoordinator !== undefined) {
      const state = await codexCoordinator.sync();
      return reply.code(state.status === "failed" ? 503 : 200).send(state);
    }
    if (codexCoordinator === undefined && codexAccountCoordinator !== undefined) {
      const state = await codexAccountCoordinator.sync();
      return reply.code(state.status === "failed" ? 503 : 200).send(state);
    }

    const [local, account] = await Promise.all([
      codexCoordinator?.sync(),
      codexAccountCoordinator?.sync(),
    ]);
    const states = [local?.status, account?.status].filter((status) => status !== undefined);
    const status = states.every((state) => state === "failed")
      ? "failed"
      : states.some((state) => state === "failed" || state === "partial")
        ? "partial"
        : "succeeded";
    return reply.code(status === "failed" ? 503 : 200).send({ status, local, account });
  });

  app.post("/api/sync", async (request, reply) => {
    if (githubCoordinator === undefined && codexCoordinator === undefined && codexAccountCoordinator === undefined) {
      return reply.code(503).send({
        status: "unavailable",
        error: "Synchronization is not configured",
      });
    }

    // Interactive clients can acknowledge immediately and observe each collector separately.
    // Keep the blocking response for scripts that need the final result.
    const preference = [request.headers.prefer].flat().join(",");
    if (preference.split(",").some((value) => value.trim() === "respond-async")) {
      if (githubCoordinator) runInBackground("GitHub", () => githubCoordinator.sync());
      if (codexCoordinator) runInBackground("Codex", () => codexCoordinator.sync());
      if (codexAccountCoordinator) runInBackground("Codex", () => codexAccountCoordinator.sync());
      return reply.code(202).header("preference-applied", "respond-async").send({ status: "running" });
    }

    const [github, codex, codexAccount] = await Promise.all([
      githubCoordinator?.sync(),
      codexCoordinator?.sync(),
      codexAccountCoordinator?.sync(),
    ]);
    const states = [github?.status, codex?.status, codexAccount?.status].filter((status) => status !== undefined);
    const status = states.every((state) => state === "failed")
      ? "failed"
      : states.some((state) => state === "failed" || state === "partial")
        ? "partial"
        : "succeeded";

    return reply.code(status === "failed" ? 503 : 200).send({ status, github, codex, codexAccount });
  });

  app.get("/api/events", async (_request, reply) => {
    reply.hijack();
    activeEventStreams.add(reply.raw);
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
      codexAccountSync: codexAccountCoordinator?.state ?? { status: "disabled" },
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
      activeEventStreams.delete(reply.raw);
    }

    reply.raw.once("close", cleanup);
    reply.raw.once("error", cleanup);
  });

  const runInBackground = (
    name: "GitHub" | "Codex",
    sync: () => Promise<{ status: string; error?: { code: string } }>,
  ) => {
    void sync()
      .then((state) => {
        if (state.status === "failed") {
          app.log.warn({ code: state.error?.code }, `${name} synchronization failed`);
        }
      })
      .catch(() => app.log.warn(`${name} synchronization failed unexpectedly`))
      .finally(() => {
        const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
        collectGarbage?.();
      });
  };

  const scheduleRefresh = (
    name: "GitHub" | "Codex",
    sync: () => Promise<{ status: string; error?: { code: string } }>,
    syncOnStart: boolean,
    intervalMs: number | undefined,
  ) => {
    if (syncOnStart) runInBackground(name, sync);
    if (intervalMs === undefined || intervalMs <= 0) return;
    const timer = setInterval(() => runInBackground(name, sync), intervalMs);
    timer.unref();
    scheduledRefreshes.push(timer);
  };

  app.addHook("onReady", () => {
    if (githubCoordinator !== undefined) {
      scheduleRefresh(
        "GitHub",
        () => githubCoordinator.sync(),
        options.githubSyncOnStart === true,
        options.githubSyncIntervalMs,
      );
    }
    if (codexCoordinator !== undefined) {
      scheduleRefresh(
        "Codex",
        () => codexCoordinator.sync(),
        options.codexSyncOnStart === true,
        options.codexSyncIntervalMs,
      );
    }
    if (codexAccountCoordinator !== undefined) {
      scheduleRefresh(
        "Codex",
        () => codexAccountCoordinator.sync(),
        options.codexSyncOnStart === true,
        options.codexSyncIntervalMs,
      );
    }
  });

  app.addHook("onClose", () => {
    for (const timer of scheduledRefreshes.splice(0)) clearInterval(timer);
  });

  app.addHook("preClose", () => {
    for (const stream of activeEventStreams) stream.end();
    activeEventStreams.clear();
  });

  if (options.dashboardPath !== undefined) {
    const dashboardRoot = resolve(options.dashboardPath);
    const contentTypes: Record<string, string> = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };

    app.get("/api/*", async (_request, reply) => {
      return reply.code(404).send({ error: "API endpoint not found" });
    });

    app.get("/*", async (request, reply) => {
      const requestedPath = normalize(decodeURIComponent(request.url.split("?", 1)[0] ?? "/"));
      const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
      const candidate = resolve(join(dashboardRoot, relativePath));
      const withinDashboard = candidate === dashboardRoot || candidate.startsWith(`${dashboardRoot}${sep}`);
      const filePath =
        withinDashboard && existsSync(candidate) && statSync(candidate).isFile()
          ? candidate
          : join(dashboardRoot, "index.html");

      if (!existsSync(filePath)) {
        return reply.code(404).send({ error: "Dashboard assets are unavailable" });
      }

      reply.header("cache-control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
      reply.type(contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream");
      return reply.send(createReadStream(filePath));
    });
  }

  return app;
}
