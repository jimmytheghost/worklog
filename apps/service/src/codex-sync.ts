import {
  CodexCollectorError,
  type CodexCollectionResult,
  type CodexCollector,
  type CodexCollectorErrorCode,
} from "@agent-dashboard/collector-codex";
import type { Storage } from "@agent-dashboard/storage";

import type { ServiceEventHub } from "./events.js";

export const CODEX_SOURCE_ID = "codex:local";
export const CODEX_COVERAGE_KEY = `${CODEX_SOURCE_ID}:observed`;
const EXPECTED_SYNC_INTERVAL_MS = 15 * 60 * 1_000;

type StoragePort = Pick<
  Storage,
  "upsertSource" | "insertEvents" | "getCoverage" | "upsertCoverage"
>;

export type CodexCollectorPort = Pick<CodexCollector, "collect">;

export type CodexSyncState = {
  status: "idle" | "running" | "succeeded" | "partial" | "failed";
  startedAt?: string;
  completedAt?: string;
  insertedEvents?: number;
  ignoredEvents?: number;
  sessions?: number;
  warnings?: number;
  error?: { code: CodexCollectorErrorCode; message: string };
};

const SAFE_FAILURE_MESSAGES: Record<CodexCollectorErrorCode, string> = {
  source_missing: "Local Codex metadata is unavailable",
  unsupported_schema: "Local Codex metadata uses an unsupported schema",
  read_failed: "Local Codex metadata could not be read",
};

function safeFailure(code: CodexCollectorErrorCode) {
  return { code, message: SAFE_FAILURE_MESSAGES[code] };
}

function thrownFailure(error: unknown) {
  return safeFailure(error instanceof CodexCollectorError ? error.code : "read_failed");
}

export class CodexSyncCoordinator {
  #activeSync: Promise<CodexSyncState> | undefined;
  #state: CodexSyncState = { status: "idle" };

  constructor(
    private readonly storage: StoragePort,
    private readonly collector: CodexCollectorPort,
    private readonly events: ServiceEventHub,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get state(): CodexSyncState {
    return this.#state;
  }

  sync(): Promise<CodexSyncState> {
    if (this.#activeSync !== undefined) return this.#activeSync;
    this.#activeSync = this.#run().finally(() => {
      this.#activeSync = undefined;
    });
    return this.#activeSync;
  }

  async #run(): Promise<CodexSyncState> {
    const startedAt = this.now().toISOString();
    this.#setState({ status: "running", startedAt });

    let result: CodexCollectionResult;
    try {
      result = await this.collector.collect();
    } catch (error) {
      const completedAt = this.now().toISOString();
      const failure = thrownFailure(error);
      this.#recordFailureIfConfigured(failure.message, completedAt);
      const state: CodexSyncState = { status: "failed", startedAt, completedAt, error: failure };
      this.#setState(state);
      return state;
    }

    const completedAt = this.now().toISOString();
    try {
      this.storage.upsertSource(
        {
          id: CODEX_SOURCE_ID,
          system: "codex_local",
          immutableSourceId: result.sourceInstanceId,
          displayName: "Local Codex metadata",
        },
        startedAt,
      );
      const inserted = this.storage.insertEvents(result.events);
      this.storage.upsertCoverage(
        {
          coverageKey: CODEX_COVERAGE_KEY,
          sourceId: CODEX_SOURCE_ID,
          metric: "codex_observed_tokens",
          completeness: result.coverage.completeness,
          coverageEnd: result.coverage.observedAt,
          coverageReason: "Experimental metadata-only adapter over local Codex formats",
          lastAttemptedAt: completedAt,
          lastSucceededAt: result.coverage.observedAt,
          expectedSyncIntervalMs: EXPECTED_SYNC_INTERVAL_MS,
        },
        completedAt,
      );
      const state: CodexSyncState = {
        status: result.warnings.length === 0 ? "succeeded" : "partial",
        startedAt,
        completedAt,
        insertedEvents: inserted.inserted,
        ignoredEvents: inserted.ignored,
        sessions: result.sessions.length,
        warnings: result.warnings.length,
      };
      this.#setState(state);
      return state;
    } catch {
      const failure = safeFailure("read_failed");
      this.#recordFailureIfConfigured(failure.message, completedAt);
      const state: CodexSyncState = { status: "failed", startedAt, completedAt, error: failure };
      this.#setState(state);
      return state;
    }
  }

  #recordFailureIfConfigured(message: string, completedAt: string): void {
    try {
      const existing = this.storage.getCoverage(CODEX_COVERAGE_KEY, this.now());
      if (existing === undefined) return;
      this.storage.upsertCoverage(
        {
          ...existing,
          lastAttemptedAt: completedAt,
          latestError: message,
        },
        completedAt,
      );
    } catch {
      // A secondary persistence failure must not leak storage details or replace the safe sync error.
    }
  }

  #setState(state: CodexSyncState): void {
    this.#state = state;
    this.events.publish({ event: "codex-sync", data: { ...state } });
  }
}
