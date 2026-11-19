import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

import type { CodexSessionStatus, CumulativeTokenObservation, RolloutMetadata, TokenBucket } from "./types.js";

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isoInstant(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

// Codex-era IANA time zones have minute-aligned offsets. One observation per
// UTC minute preserves local day boundaries without storing each token event.
export function activityMinute(instant: string): string {
  return `${instant.slice(0, 16)}:00.000Z`;
}

function cumulativeSnapshot(
  lineNumber: number,
  timestamp: unknown,
  info: unknown,
): CumulativeTokenObservation | undefined {
  const observedAt = isoInstant(timestamp);
  if (observedAt === undefined) return undefined;
  const unavailable = (): CumulativeTokenObservation => ({
    lineNumber,
    observedAt,
    countersAvailable: false,
  });
  if (typeof info !== "object" || info === null) return unavailable();
  const total = (info as Record<string, unknown>).total_token_usage;
  if (typeof total !== "object" || total === null) return unavailable();
  const counters = total as Record<string, unknown>;
  const inputTokens = nonnegativeInteger(counters.input_tokens);
  const cachedTokens = nonnegativeInteger(counters.cached_input_tokens);
  const cacheWriteTokens = nonnegativeInteger(counters.cache_write_input_tokens);
  const outputTokens = nonnegativeInteger(counters.output_tokens);
  const reasoningTokens = nonnegativeInteger(counters.reasoning_output_tokens);
  const totalTokens = nonnegativeInteger(counters.total_tokens);
  if (
    inputTokens === undefined ||
    cachedTokens === undefined ||
    cacheWriteTokens === undefined ||
    outputTokens === undefined ||
    reasoningTokens === undefined ||
    totalTokens === undefined
  ) {
    return unavailable();
  }
  return {
    lineNumber,
    observedAt,
    countersAvailable: true,
    inputTokens,
    cachedTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function normalizedTerminalStatus(value: string): CodexSessionStatus | undefined {
  if (value === "task_complete") return "completed";
  if (value === "turn_aborted") return "interrupted";
  return undefined;
}

/**
 * Parses only explicitly allowlisted envelope and counter/lifecycle fields.
 * Response items, messages, tool calls, commands, arguments, and output are never parsed.
 */
export async function readRolloutMetadata(filename: string, sessionId: string, startedAt: string): Promise<RolloutMetadata> {
  if (!existsSync(filename)) {
    return { malformedMetadataLines: 0, missingCumulativeCounters: false };
  }
  const input = createReadStream(filename, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let latestTokenObservation: CumulativeTokenObservation | undefined;
  let parentSessionId: string | undefined;
  let terminalStatus: CodexSessionStatus | undefined;
  let terminalAt: string | undefined;
  let terminalDurationMilliseconds: number | undefined;
  let malformedMetadataLines = 0;
  let missingCumulativeCounters = false;
  const tokenBuckets = new Map<string, TokenBucket>();
  let previousTotal: number | undefined;
  let sawSessionStart = false;
  let gap = false;
  let belongsToSession = true;
  const activityMinutes = new Set<string>();

  for await (const line of lines) {
    lineNumber += 1;
    const relevant =
      line.includes('"type":"event_msg"') ||
      line.includes('"type": "event_msg"') ||
      line.includes('"type":"session_meta"') ||
      line.includes('"type": "session_meta"');
    if (!relevant) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      malformedMetadataLines += 1;
      gap = true;
      continue;
    }
    if (typeof record !== "object" || record === null) continue;
    const envelope = record as Record<string, unknown>;
    const payload = envelope.payload;
    if (typeof payload !== "object" || payload === null) continue;
    const metadata = payload as Record<string, unknown>;

    if (envelope.type === "session_meta") {
      belongsToSession = metadata.id === sessionId;
      if (belongsToSession) sawSessionStart = true;

      if (typeof metadata.parent_thread_id === "string" && metadata.parent_thread_id.length > 0) {
        parentSessionId = metadata.parent_thread_id;
      }
      continue;
    }
    if (envelope.type !== "event_msg" || typeof metadata.type !== "string") continue;

    if (["token_count", "task_started", "task_complete", "turn_aborted"].includes(metadata.type)) {
      const instant = isoInstant(envelope.timestamp);
      if (instant !== undefined) activityMinutes.add(activityMinute(instant));
    }

    if (metadata.type === "token_count") {
      const instant = isoInstant(envelope.timestamp);
      if (!instant && belongsToSession) gap = true;
      if (instant && belongsToSession && instant >= startedAt) {
        const info = metadata.info as {
          total_token_usage?: { total_tokens?: unknown };
          last_token_usage?: { total_tokens?: unknown };
        } | null;
        const total = nonnegativeInteger(info?.total_token_usage?.total_tokens);
        const last = nonnegativeInteger(info?.last_token_usage?.total_tokens);
        const minute = activityMinute(instant);
        const bucket = tokenBuckets.get(minute) ?? { instant: minute, tokens: null, partial: false };
        let increment: number | undefined;
        if (total === undefined) {
          gap = true;
        } else {
          if (previousTotal === total) {
            increment = 0;
          } else if (!gap && previousTotal !== undefined && total >= previousTotal) {
            increment = total - previousTotal;
          } else if (!gap && previousTotal === undefined && sawSessionStart &&
              (last === total || (last === undefined && !parentSessionId))) {
            increment = total;
          } else {
            // Across a reset, inherited baseline, or gap only the explicitly
            // reported latest increment can be placed at this timestamp.
            if (last !== undefined && last <= total) increment = last;
            bucket.partial = true;
          }
          previousTotal = total;
          gap = false;
        }
        if (increment === undefined) bucket.partial = true;
        else bucket.tokens = (bucket.tokens ?? 0) + increment;
        tokenBuckets.set(minute, bucket);
      }
      const selected = cumulativeSnapshot(lineNumber, envelope.timestamp, metadata.info);
      if (selected !== undefined) {
        latestTokenObservation = selected;
        missingCumulativeCounters = !selected.countersAvailable;
      }
      continue;
    }

    const status = normalizedTerminalStatus(metadata.type);
    if (status !== undefined) {
      terminalStatus = status;
      terminalAt =
        isoInstant(metadata.completed_at) ?? isoInstant(envelope.timestamp) ?? terminalAt;
      const duration = nonnegativeInteger(metadata.duration_ms);
      if (duration !== undefined) terminalDurationMilliseconds = duration;
    } else if (metadata.type === "task_started") {
      terminalStatus = undefined;
      terminalAt = undefined;
      terminalDurationMilliseconds = undefined;
    }
  }

  return {
    tokenBuckets: [...tokenBuckets.values()],
    activityMinutes: [...activityMinutes],
    ...(latestTokenObservation === undefined ? {} : { latestTokenObservation }),
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    ...(terminalStatus === undefined ? {} : { terminalStatus }),
    ...(terminalAt === undefined ? {} : { terminalAt }),
    ...(terminalDurationMilliseconds === undefined ? {} : { terminalDurationMilliseconds }),
    malformedMetadataLines,
    missingCumulativeCounters,
  };
}
