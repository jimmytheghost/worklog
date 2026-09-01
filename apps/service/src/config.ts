import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const DEFAULT_DATABASE_PATH = join(
  homedir(),
  ".agent-dashboard",
  "agent-dashboard.sqlite",
);

export const DEFAULT_DASHBOARD_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../dashboard/dist",
);

export const DEFAULT_MIGRATIONS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/storage/drizzle",
);

const timeZone = z.string().trim().min(1).refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid IANA timezone" },
);

const booleanFromEnvironment = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const refreshInterval = z.coerce
  .number()
  .int()
  .min(0)
  .max(7 * 24 * 60 * 60 * 1_000);

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE_HOST: z.string().trim().min(1).default("127.0.0.1"),
  SERVICE_PORT: z.coerce.number().int().min(1).max(65_535).default(4317),
  SERVICE_DATABASE_PATH: z.string().trim().min(1).default(DEFAULT_DATABASE_PATH),
  SERVICE_DASHBOARD_PATH: z.string().trim().min(1).default(DEFAULT_DASHBOARD_PATH),
  SERVICE_MIGRATIONS_PATH: z.string().trim().min(1).default(DEFAULT_MIGRATIONS_PATH),
  SERVICE_TIMEZONE: timeZone.default("America/Denver"),
  GITHUB_SYNC_ON_START: booleanFromEnvironment,
  CODEX_SYNC_ON_START: booleanFromEnvironment,
  GITHUB_SYNC_INTERVAL_MS: refreshInterval.default(15 * 60 * 1_000),
  CODEX_SYNC_INTERVAL_MS: refreshInterval.default(5 * 60 * 1_000),
  SERVICE_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SERVICE_SSE_HEARTBEAT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
});

export type ServiceConfig = {
  environment: z.infer<typeof configSchema>["NODE_ENV"];
  host: string;
  port: number;
  databasePath: string;
  dashboardPath: string;
  migrationsPath: string;
  timeZone: string;
  githubSyncOnStart: boolean;
  codexSyncOnStart: boolean;
  githubSyncIntervalMs: number;
  codexSyncIntervalMs: number;
  logLevel: z.infer<typeof configSchema>["SERVICE_LOG_LEVEL"];
  sseHeartbeatMs: number;
};

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const parsed = configSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid service configuration: ${details}`);
  }

  return {
    environment: parsed.data.NODE_ENV,
    host: parsed.data.SERVICE_HOST,
    port: parsed.data.SERVICE_PORT,
    databasePath: parsed.data.SERVICE_DATABASE_PATH,
    dashboardPath: parsed.data.SERVICE_DASHBOARD_PATH,
    migrationsPath: parsed.data.SERVICE_MIGRATIONS_PATH,
    timeZone: parsed.data.SERVICE_TIMEZONE,
    githubSyncOnStart: parsed.data.GITHUB_SYNC_ON_START,
    codexSyncOnStart: parsed.data.CODEX_SYNC_ON_START,
    githubSyncIntervalMs: parsed.data.GITHUB_SYNC_INTERVAL_MS,
    codexSyncIntervalMs: parsed.data.CODEX_SYNC_INTERVAL_MS,
    logLevel: parsed.data.SERVICE_LOG_LEVEL,
    sseHeartbeatMs: parsed.data.SERVICE_SSE_HEARTBEAT_MS,
  };
}
