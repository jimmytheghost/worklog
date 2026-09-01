import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  CodexAccountUsageSnapshot,
  CodexRateLimitBucket,
  CodexRateLimitWindow,
} from "@agent-dashboard/domain";

export type CodexAccountCollectorErrorCode =
  | "cli_missing"
  | "authentication_unavailable"
  | "protocol_error"
  | "timed_out"
  | "read_failed";

export class CodexAccountCollectorError extends Error {
  constructor(
    readonly code: CodexAccountCollectorErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CodexAccountCollectorError";
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unixInstant(value: unknown): string | null {
  const seconds = nullableNumber(value);
  return seconds === null ? null : new Date(seconds * 1_000).toISOString();
}

function rateWindow(value: unknown): CodexRateLimitWindow | null {
  const row = object(value);
  const usedPercent = nullableNumber(row?.usedPercent);
  if (row === undefined || usedPercent === null) return null;
  return {
    usedPercent,
    windowDurationMinutes: nullableNumber(row.windowDurationMins),
    resetsAt: unixInstant(row.resetsAt),
  };
}

function credits(value: unknown): CodexRateLimitBucket["credits"] {
  const row = object(value);
  if (row === undefined || typeof row.hasCredits !== "boolean" || typeof row.unlimited !== "boolean") {
    return null;
  }
  return {
    hasCredits: row.hasCredits,
    unlimited: row.unlimited,
    balance: nullableString(row.balance),
  };
}

function limitBucket(fallbackId: string, value: unknown): CodexRateLimitBucket | null {
  const row = object(value);
  if (row === undefined) return null;
  const individual = object(row.individualLimit);
  const individualResetsAt = unixInstant(individual?.resetsAt);
  const individualLimit =
    individual !== undefined
    && typeof individual.limit === "string"
    && typeof individual.used === "string"
    && nullableNumber(individual.remainingPercent) !== null
    && individualResetsAt !== null
      ? {
          limit: individual.limit,
          used: individual.used,
          remainingPercent: nullableNumber(individual.remainingPercent)!,
          resetsAt: individualResetsAt,
        }
      : null;
  return {
    limitId: nullableString(row.limitId) ?? fallbackId,
    limitName: nullableString(row.limitName),
    planType: nullableString(row.planType),
    primary: rateWindow(row.primary),
    secondary: rateWindow(row.secondary),
    credits: credits(row.credits),
    individualLimit,
    spendControlReached: typeof row.spendControlReached === "boolean" ? row.spendControlReached : null,
    rateLimitReachedType: nullableString(row.rateLimitReachedType),
  };
}

export function normalizeCodexAccountUsage(
  accountResponse: unknown,
  rateLimitResponse: unknown,
  usageResponse: unknown,
  observedAt: string,
): CodexAccountUsageSnapshot {
  const accountResult = object(accountResponse);
  const account = object(accountResult?.account);
  if (account === undefined) {
    throw new CodexAccountCollectorError(
      "authentication_unavailable",
      "Codex is not signed in with an account that exposes usage",
    );
  }

  const rateResult = object(rateLimitResponse);
  const byId = object(rateResult?.rateLimitsByLimitId);
  const buckets: CodexRateLimitBucket[] = [];
  if (byId !== undefined) {
    for (const [id, value] of Object.entries(byId)) {
      const bucket = limitBucket(id, value);
      if (bucket !== null) buckets.push(bucket);
    }
  }
  if (buckets.length === 0) {
    const fallback = limitBucket("codex", rateResult?.rateLimits);
    if (fallback !== null) buckets.push(fallback);
  }
  buckets.sort((left, right) => {
    if (left.limitId === "codex") return -1;
    if (right.limitId === "codex") return 1;
    return left.limitId.localeCompare(right.limitId);
  });

  const resetCredits = object(rateResult?.rateLimitResetCredits);
  const usageResult = object(usageResponse);
  const summary = object(usageResult?.summary) ?? {};
  const dailyValue = usageResult?.dailyUsageBuckets;
  const daily = Array.isArray(dailyValue)
    ? dailyValue.flatMap((value) => {
        const row = object(value);
        return typeof row?.startDate === "string" && nullableNumber(row.tokens) !== null
          ? [{ date: row.startDate, tokens: nullableNumber(row.tokens)! }]
          : [];
      })
    : null;
  const identity = JSON.stringify({
    type: nullableString(account.type),
    email: nullableString(account.email),
    planType: nullableString(account.planType),
  });

  return {
    sourceInstanceId: createHash("sha256").update(identity).digest("hex"),
    observedAt,
    planType: nullableString(account.planType) ?? buckets.find((bucket) => bucket.planType !== null)?.planType ?? null,
    rateLimits: buckets,
    bankedResetCount: nullableNumber(resetCredits?.availableCount),
    credits: buckets.find((bucket) => bucket.limitId === "codex")?.credits
      ?? buckets.find((bucket) => bucket.credits !== null)?.credits
      ?? null,
    tokenUsage: {
      lifetimeTokens: nullableNumber(summary.lifetimeTokens),
      peakDailyTokens: nullableNumber(summary.peakDailyTokens),
      longestRunningTurnSeconds: nullableNumber(summary.longestRunningTurnSec),
      currentStreakDays: nullableNumber(summary.currentStreakDays),
      longestStreakDays: nullableNumber(summary.longestStreakDays),
      daily,
    },
  };
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type CodexAccountCollectorOptions = {
  executablePath?: string;
  timeoutMilliseconds?: number;
  now?: () => Date;
};

export class CodexAccountCollector {
  readonly #executablePath: string;
  readonly #timeoutMilliseconds: number;
  readonly #now: () => Date;

  constructor(options: CodexAccountCollectorOptions = {}) {
    this.#executablePath = options.executablePath ?? process.env.CODEX_BINARY ?? "codex";
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 15_000;
    this.#now = options.now ?? (() => new Date());
  }

  async collect(): Promise<CodexAccountUsageSnapshot> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.#executablePath, ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch (cause) {
      throw new CodexAccountCollectorError("cli_missing", "Codex CLI is unavailable", { cause });
    }

    let buffer = "";
    let nextId = 1;
    const pending = new Map<number, PendingRequest>();
    let launchError: Error | undefined;
    child.once("error", (error) => {
      launchError = error;
      for (const request of pending.values()) request.reject(error);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: JsonObject;
        try {
          message = JSON.parse(line) as JsonObject;
        } catch {
          continue;
        }
        if (typeof message.id !== "number") continue;
        const request = pending.get(message.id);
        if (request === undefined) continue;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error !== undefined) {
          const rpcError = object(message.error);
          request.reject(new CodexAccountCollectorError(
            "protocol_error",
            nullableString(rpcError?.message) ?? "Codex usage request failed",
          ));
        } else {
          request.resolve(message.result);
        }
      }
    });

    const request = (method: string, params?: JsonObject): Promise<unknown> => {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CodexAccountCollectorError("timed_out", "Codex usage request timed out"));
        }, this.#timeoutMilliseconds);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`);
      });
    };

    try {
      await request("initialize", {
        clientInfo: { name: "worklog", title: "Worklog", version: "0.0.0" },
        capabilities: {},
      });
      child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      const [account, rateLimits, usage] = await Promise.all([
        request("account/read", { refreshToken: false }),
        request("account/rateLimits/read"),
        request("account/usage/read"),
      ]);
      return normalizeCodexAccountUsage(
        account,
        rateLimits,
        usage,
        this.#now().toISOString(),
      );
    } catch (cause) {
      if (cause instanceof CodexAccountCollectorError) throw cause;
      if (launchError !== undefined && "code" in launchError && launchError.code === "ENOENT") {
        throw new CodexAccountCollectorError("cli_missing", "Codex CLI is unavailable", { cause });
      }
      throw new CodexAccountCollectorError("read_failed", "Codex account usage could not be read", { cause });
    } finally {
      for (const request of pending.values()) clearTimeout(request.timer);
      pending.clear();
      child.stdin.end();
      if (!child.killed) child.kill("SIGTERM");
    }
  }
}
