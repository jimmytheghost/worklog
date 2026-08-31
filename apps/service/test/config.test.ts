import { describe, expect, it } from "vitest";

import { DEFAULT_DATABASE_PATH, readConfig } from "../src/config.js";

describe("service configuration", () => {
  it("defaults to loopback with safe local settings", () => {
    expect(readConfig({})).toEqual({
      environment: "development",
      host: "127.0.0.1",
      port: 4317,
      databasePath: DEFAULT_DATABASE_PATH,
      timeZone: "America/Denver",
      githubSyncOnStart: false,
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
        SERVICE_DATABASE_PATH: ":memory:",
        SERVICE_TIMEZONE: "UTC",
        GITHUB_SYNC_ON_START: "true",
        SERVICE_LOG_LEVEL: "silent",
        SERVICE_SSE_HEARTBEAT_MS: "3000",
      }),
    ).toEqual({
      environment: "test",
      host: "::1",
      port: 5000,
      databasePath: ":memory:",
      timeZone: "UTC",
      githubSyncOnStart: true,
      logLevel: "silent",
      sseHeartbeatMs: 3000,
    });
  });

  it("rejects invalid ports and heartbeat intervals", () => {
    expect(() =>
      readConfig({ SERVICE_PORT: "70000", SERVICE_SSE_HEARTBEAT_MS: "99" }),
    ).toThrowError(/Invalid service configuration/);
  });

  it("rejects invalid timezones and boolean flags", () => {
    expect(() => readConfig({ SERVICE_TIMEZONE: "Mountain-ish" })).toThrowError(
      /valid IANA timezone/,
    );
    expect(() => readConfig({ GITHUB_SYNC_ON_START: "sometimes" })).toThrowError(
      /Invalid service configuration/,
    );
  });
});
