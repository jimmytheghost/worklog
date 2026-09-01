import { describe, expect, it } from "vitest";

import {
  DEFAULT_DASHBOARD_PATH,
  DEFAULT_DATABASE_PATH,
  DEFAULT_MIGRATIONS_PATH,
  readConfig,
} from "../src/config.js";

describe("service configuration", () => {
  it("defaults to loopback with safe local settings", () => {
    expect(readConfig({})).toEqual({
      environment: "development",
      host: "127.0.0.1",
      port: 4317,
      databasePath: DEFAULT_DATABASE_PATH,
      dashboardPath: DEFAULT_DASHBOARD_PATH,
      migrationsPath: DEFAULT_MIGRATIONS_PATH,
      timeZone: "America/Denver",
      githubSyncOnStart: false,
      codexSyncOnStart: false,
      githubSyncIntervalMs: 15 * 60 * 1_000,
      codexSyncIntervalMs: 5 * 60 * 1_000,
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
        SERVICE_DASHBOARD_PATH: "/tmp/dashboard-build",
        SERVICE_MIGRATIONS_PATH: "/tmp/storage-migrations",
        SERVICE_TIMEZONE: "UTC",
        GITHUB_SYNC_ON_START: "true",
        CODEX_SYNC_ON_START: "1",
        GITHUB_SYNC_INTERVAL_MS: "60000",
        CODEX_SYNC_INTERVAL_MS: "0",
        SERVICE_LOG_LEVEL: "silent",
        SERVICE_SSE_HEARTBEAT_MS: "3000",
      }),
    ).toEqual({
      environment: "test",
      host: "::1",
      port: 5000,
      databasePath: ":memory:",
      dashboardPath: "/tmp/dashboard-build",
      migrationsPath: "/tmp/storage-migrations",
      timeZone: "UTC",
      githubSyncOnStart: true,
      codexSyncOnStart: true,
      githubSyncIntervalMs: 60_000,
      codexSyncIntervalMs: 0,
      logLevel: "silent",
      sseHeartbeatMs: 3000,
    });
  });

  it("rejects invalid ports and heartbeat intervals", () => {
    expect(() =>
      readConfig({ SERVICE_PORT: "70000", SERVICE_SSE_HEARTBEAT_MS: "99" }),
    ).toThrowError(/Invalid service configuration/);
    expect(() => readConfig({ GITHUB_SYNC_INTERVAL_MS: "-1" })).toThrowError(
      /Invalid service configuration/,
    );
  });

  it("rejects invalid timezones and boolean flags", () => {
    expect(() => readConfig({ SERVICE_TIMEZONE: "Mountain-ish" })).toThrowError(
      /valid IANA timezone/,
    );
    expect(() => readConfig({ GITHUB_SYNC_ON_START: "sometimes" })).toThrowError(
      /Invalid service configuration/,
    );
    expect(() => readConfig({ CODEX_SYNC_ON_START: "sometimes" })).toThrowError(
      /Invalid service configuration/,
    );
  });
});
