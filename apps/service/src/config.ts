import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE_HOST: z.string().trim().min(1).default("127.0.0.1"),
  SERVICE_PORT: z.coerce.number().int().min(1).max(65_535).default(4317),
  SERVICE_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SERVICE_SSE_HEARTBEAT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
});

export type ServiceConfig = {
  environment: z.infer<typeof configSchema>["NODE_ENV"];
  host: string;
  port: number;
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
    logLevel: parsed.data.SERVICE_LOG_LEVEL,
    sseHeartbeatMs: parsed.data.SERVICE_SSE_HEARTBEAT_MS,
  };
}
