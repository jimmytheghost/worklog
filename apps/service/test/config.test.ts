import { describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";

describe("service configuration", () => {
  it("defaults to loopback with safe local settings", () => {
    expect(readConfig({})).toEqual({
      environment: "development",
      host: "127.0.0.1",
      port: 4317,
      logLevel: "info",
      sseHeartbeatMs: 15_000,
    });
  });

  it("accepts valid environment overrides", () => {
    expect(
      readConfig({
        NODE_ENV: "test",
        SERVICE_HOST: "::1",
        SERVICE_PORT: "5000",
        SERVICE_LOG_LEVEL: "silent",
        SERVICE_SSE_HEARTBEAT_MS: "3000",
      }),
    ).toEqual({
      environment: "test",
      host: "::1",
      port: 5000,
      logLevel: "silent",
      sseHeartbeatMs: 3000,
    });
  });

  it("rejects invalid ports and heartbeat intervals", () => {
    expect(() =>
      readConfig({ SERVICE_PORT: "70000", SERVICE_SSE_HEARTBEAT_MS: "99" }),
    ).toThrowError(/Invalid service configuration/);
  });
});
