import { afterEach, describe, expect, it } from "vitest";

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
});
