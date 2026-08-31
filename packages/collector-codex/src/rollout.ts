import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

import type { CodexSessionStatus, CumulativeTokenObservation, RolloutMetadata } from "./types.js";

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isoInstant(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
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
export async function readRolloutMetadata(filename: string): Promise<RolloutMetadata> {
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
      continue;
    }
    if (typeof record !== "object" || record === null) continue;
    const envelope = record as Record<string, unknown>;
    const payload = envelope.payload;
    if (typeof payload !== "object" || payload === null) continue;
    const metadata = payload as Record<string, unknown>;

    if (envelope.type === "session_meta") {
      if (typeof metadata.parent_thread_id === "string" && metadata.parent_thread_id.length > 0) {
        parentSessionId = metadata.parent_thread_id;
      }
      continue;
    }
    if (envelope.type !== "event_msg" || typeof metadata.type !== "string") continue;

    if (metadata.type === "token_count") {
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
    ...(latestTokenObservation === undefined ? {} : { latestTokenObservation }),
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    ...(terminalStatus === undefined ? {} : { terminalStatus }),
    ...(terminalAt === undefined ? {} : { terminalAt }),
    ...(terminalDurationMilliseconds === undefined ? {} : { terminalDurationMilliseconds }),
    malformedMetadataLines,
    missingCumulativeCounters,
  };
}
