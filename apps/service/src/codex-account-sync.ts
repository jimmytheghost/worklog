import {
  CodexAccountCollectorError,
  type CodexAccountCollectorErrorCode,
} from "@agent-dashboard/collector-codex";
import type { CodexAccountUsageSnapshot } from "@agent-dashboard/domain";
import type { Storage } from "@agent-dashboard/storage";

import type { ServiceEventHub } from "./events.js";

export const CODEX_ACCOUNT_SOURCE_ID = "codex:account";
export const CODEX_ACCOUNT_COVERAGE_KEY = `${CODEX_ACCOUNT_SOURCE_ID}:usage`;
const EXPECTED_SYNC_INTERVAL_MS = 15 * 60 * 1_000;

type StoragePort = Pick<
  Storage,
  "upsertSource" | "upsertCodexAccountUsage" | "getCoverage" | "upsertCoverage"
>;

export type CodexAccountCollectorPort = {
  collect(): Promise<CodexAccountUsageSnapshot>;
};

export type CodexAccountSyncState = {
  status: "idle" | "running" | "succeeded" | "failed";
  startedAt?: string;
  completedAt?: string;
  limits?: number;
  bankedResetCount?: number | null;
  error?: { code: CodexAccountCollectorErrorCode; message: string };
};

const SAFE_FAILURE_MESSAGES: Record<CodexAccountCollectorErrorCode, string> = {
  cli_missing: "Codex CLI is unavailable",
  authentication_unavailable: "Sign in to Codex to see account usage",
  protocol_error: "Codex account usage is unavailable from this CLI version",
  timed_out: "Codex account usage refresh timed out",
  read_failed: "Codex account usage could not be read",
};

export class CodexAccountSyncCoordinator {
  #activeSync: Promise<CodexAccountSyncState> | undefined;
  #state: CodexAccountSyncState = { status: "idle" };

  constructor(
    private readonly storage: StoragePort,
    private readonly collector: CodexAccountCollectorPort,
    private readonly events: ServiceEventHub,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get state(): CodexAccountSyncState {
    return this.#state;
  }

  sync(): Promise<CodexAccountSyncState> {
    if (this.#activeSync !== undefined) return this.#activeSync;
    this.#activeSync = this.#run().finally(() => { this.#activeSync = undefined; });
    return this.#activeSync;
  }

  async #run(): Promise<CodexAccountSyncState> {
    const startedAt = this.now().toISOString();
    this.#setState({ status: "running", startedAt });
    try {
      const snapshot = await this.collector.collect();
      const completedAt = this.now().toISOString();
      const sourceId = `${CODEX_ACCOUNT_SOURCE_ID}:${snapshot.sourceInstanceId.slice(0, 16)}`;
      this.storage.upsertSource({
        id: sourceId,
        system: "codex_account",
        immutableSourceId: snapshot.sourceInstanceId,
        displayName: "Codex account usage",
      }, startedAt);
      this.storage.upsertCodexAccountUsage(sourceId, snapshot, completedAt);
      this.storage.upsertCoverage({
        coverageKey: CODEX_ACCOUNT_COVERAGE_KEY,
        sourceId,
        metric: "codex_account_usage",
        completeness: "complete",
        coverageEnd: snapshot.observedAt,
        coverageReason: "Official Codex App Server account snapshot",
        lastAttemptedAt: completedAt,
        lastSucceededAt: snapshot.observedAt,
        expectedSyncIntervalMs: EXPECTED_SYNC_INTERVAL_MS,
      }, completedAt);
      const state: CodexAccountSyncState = {
        status: "succeeded",
        startedAt,
        completedAt,
        limits: snapshot.rateLimits.length,
        bankedResetCount: snapshot.bankedResetCount,
      };
      this.#setState(state);
      return state;
    } catch (error) {
      const completedAt = this.now().toISOString();
      const code = error instanceof CodexAccountCollectorError ? error.code : "read_failed";
      const failure = { code, message: SAFE_FAILURE_MESSAGES[code] };
      const existing = this.storage.getCoverage(CODEX_ACCOUNT_COVERAGE_KEY, this.now());
      if (existing !== undefined) {
        this.storage.upsertCoverage({
          ...existing,
          lastAttemptedAt: completedAt,
          latestError: failure.message,
        }, completedAt);
      }
      const state: CodexAccountSyncState = { status: "failed", startedAt, completedAt, error: failure };
      this.#setState(state);
      return state;
    }
  }

  #setState(state: CodexAccountSyncState): void {
    this.#state = state;
    this.events.publish({ event: "codex-account-sync", data: { ...state } });
  }
}
