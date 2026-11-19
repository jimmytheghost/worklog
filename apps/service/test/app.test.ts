import { afterEach, describe, expect, it } from "vitest";
import type { Storage } from "@agent-dashboard/storage";

import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("local service", () => {
  it("reports health", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "@agent-dashboard/service",
      version: "0.0.0",
    });
    expect(response.json().now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("serves the deterministic product snapshot without caching", async () => {
    const app = buildApp();
    apps.push(app);

    const first = await app.inject({ method: "GET", url: "/api/snapshot" });
    const second = await app.inject({ method: "GET", url: "/api/snapshot" });

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toBe(second.body);

    const snapshot = first.json();
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      timezone: "America/Denver",
      generatedAt: "2026-08-31T04:00:00.000Z",
    });
    expect(snapshot.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "commits", value: 18, completeness: "complete" }),
        expect.objectContaining({
          metric: "pushes",
          value: 7,
          completeness: "prospective",
        }),
      ]),
    );
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "session:dashboard-service",
          parentSessionId: "session:dashboard-root",
        }),
      ]),
    );
  });

  it("streams a connected event and heartbeat with SSE headers", async () => {
    const app = buildApp({ sseHeartbeatMs: 5, sseMaxHeartbeats: 1 });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/events" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(response.body).toContain("event: connected");
    expect(response.body).toContain("event: heartbeat");
    expect(response.body).toContain('"sequence":1');
  });

  it("closes open event streams during service shutdown", async () => {
    const app = buildApp({ sseHeartbeatMs: 60_000 });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events`);
    const reader = response.body?.getReader();
    expect((await reader?.read())?.done).toBe(false);

    await expect(app.close()).resolves.toBeUndefined();
    expect((await reader?.read())?.done).toBe(true);
  });

  it("serves only the API, including for old dashboard URLs", async () => {
    const app = buildApp();
    apps.push(app);

    for (const url of ["/", "/?view=history", "/assets/dashboard.js"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
    }
  });

  it("reports combined synchronization as unavailable when collectors are not configured", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/sync" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unavailable",
      error: "Synchronization is not configured",
    });
  });

  it("acknowledges interactive refreshes while a collector is pending and reuses the active sync", async () => {
    let calls = 0;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const app = buildApp({
      storage: { getSyncCursor: () => undefined } as unknown as Storage,
      githubCollector: { collect: async () => {
        calls += 1;
        await pending;
        throw new Error("expected failure");
      } },
    });
    apps.push(app);
    try {
      const first = await app.inject({ method: "POST", url: "/api/sync", headers: { prefer: "respond-async" } });
      expect(first.statusCode).toBe(202);
      expect(first.headers["preference-applied"]).toBe("respond-async");
      expect(first.json()).toEqual({ status: "running" });
      expect((await app.inject({ method: "GET", url: "/health" })).json().githubSync).toBe("running");
      expect((await app.inject({ method: "POST", url: "/api/sync", headers: { prefer: "respond-async" } })).statusCode).toBe(202);
      expect(calls).toBe(1);
    } finally {
      finish();
    }
    await expect.poll(async () => (await app.inject({ method: "GET", url: "/health" })).json().githubSync).toBe("failed");
    // Existing script clients still get a final response.
    const blocking = await app.inject({ method: "POST", url: "/api/sync" });
    expect(blocking.statusCode).toBe(503);
    expect(blocking.json().github.status).toBe("failed");
  });

  it("runs configured refreshes in the background without delaying readiness", async () => {
    let collectionCalls = 0;
    const app = buildApp({
      storage: { getSyncCursor: () => undefined } as unknown as Storage,
      githubCollector: {
        collect: async () => {
          collectionCalls += 1;
          throw new Error("expected test failure");
        },
      },
      fixtureMode: false,
      githubSyncOnStart: true,
      githubSyncIntervalMs: 10,
    });
    apps.push(app);

    await app.ready();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    await expect.poll(() => collectionCalls, { timeout: 500 }).toBeGreaterThanOrEqual(2);
  });
});
