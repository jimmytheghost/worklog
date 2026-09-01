import {
  GitHubCollectorError,
  type GitHubCollectionResult,
  type GitHubCollector,
  type GitHubCollectorErrorCode,
} from "@agent-dashboard/collector-github";
import type { Completeness } from "@agent-dashboard/domain";
import type { Storage } from "@agent-dashboard/storage";

import type { ServiceEventHub } from "./events.js";

export const GITHUB_SOURCE_ID = "github:primary";
const EXPECTED_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
const STREAMS = ["repositories", "commits", "pushes"] as const;
const CURSOR_ADAPTER = "github-gh-api:vnext";

type StoragePort = Pick<
  Storage,
  | "upsertSource"
  | "upsertProject"
  | "insertEvents"
  | "getCoverage"
  | "upsertCoverage"
  | "getSyncCursor"
  | "setSyncCursor"
>;

export type GitHubCollectorPort = Pick<GitHubCollector, "collect">;

export type GitHubSyncState = {
  status: "idle" | "running" | "succeeded" | "partial" | "failed";
  startedAt?: string;
  completedAt?: string;
  insertedEvents?: number;
  ignoredEvents?: number;
  repositories?: number;
  failures?: Array<{ stream: string; code: GitHubCollectorErrorCode; message: string }>;
  error?: { code: GitHubCollectorErrorCode; message: string };
};

const SAFE_FAILURE_MESSAGES: Record<GitHubCollectorErrorCode, string> = {
  invalid_input: "GitHub synchronization input is invalid",
  gh_unavailable: "GitHub CLI is unavailable",
  authentication_failed: "GitHub CLI authentication is required",
  api_failed: "GitHub API request failed",
  malformed_response: "GitHub returned an invalid response",
};

function safeFailure(code: GitHubCollectorErrorCode) {
  return { code, message: SAFE_FAILURE_MESSAGES[code] };
}

function thrownFailure(error: unknown) {
  const code: GitHubCollectorErrorCode =
    error instanceof GitHubCollectorError ? error.code : "api_failed";
  return safeFailure(code);
}

function coverageKey(stream: (typeof STREAMS)[number]): string {
  return `${GITHUB_SOURCE_ID}:${stream}`;
}

export class GitHubSyncCoordinator {
  #activeSync: Promise<GitHubSyncState> | undefined;
  #state: GitHubSyncState = { status: "idle" };

  constructor(
    private readonly storage: StoragePort,
    private readonly collector: GitHubCollectorPort,
    private readonly events: ServiceEventHub,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get state(): GitHubSyncState {
    return this.#state;
  }

  sync(): Promise<GitHubSyncState> {
    if (this.#activeSync !== undefined) return this.#activeSync;
    this.#activeSync = this.#run().finally(() => {
      this.#activeSync = undefined;
    });
    return this.#activeSync;
  }

  async #run(): Promise<GitHubSyncState> {
    const startedAt = this.now().toISOString();
    this.#setState({ status: "running", startedAt });

    let result: GitHubCollectionResult;
    try {
      const cursor = this.storage.getSyncCursor(GITHUB_SOURCE_ID, CURSOR_ADAPTER);
      const since = cursor !== null && typeof cursor === "object" && "since" in cursor && typeof cursor.since === "string"
        ? cursor.since
        : undefined;
      result = await this.collector.collect(since === undefined ? {} : { since });
    } catch (error) {
      const completedAt = this.now().toISOString();
      const failure = thrownFailure(error);
      const state: GitHubSyncState = {
        status: "failed",
        startedAt,
        completedAt,
        error: failure,
      };
      this.#setState(state);
      return state;
    }

    let inserted: { inserted: number; ignored: number };
    const completedAt = this.now().toISOString();
    try {
      this.storage.upsertSource(
        {
          id: GITHUB_SOURCE_ID,
          system: "github",
          immutableSourceId: result.account.id,
          displayName: result.account.login,
        },
        startedAt,
      );

      for (const repository of result.repositories) {
        this.storage.upsertProject(
          {
            id: repository.repositoryId,
            sourceId: GITHUB_SOURCE_ID,
            immutableSourceId: repository.id,
            name: repository.name,
            owner: repository.owner,
            defaultBranch: repository.defaultBranch,
            visibility: repository.visibility,
          },
          startedAt,
        );
      }

      // Storage validates the complete batch first and commits normalized events atomically.
      inserted = this.storage.insertEvents(result.events);
      this.#recordCoverage(result, completedAt);
      if (result.failures.length === 0) {
        // Advance to the instant immediately before collection began. Events created during
        // the network walk remain eligible on the next refresh rather than falling in a gap.
        this.storage.setSyncCursor(
          { sourceId: GITHUB_SOURCE_ID, adapterName: CURSOR_ADAPTER, cursor: { since: startedAt } },
          completedAt,
        );
      }
    } catch {
      const state: GitHubSyncState = {
        status: "failed",
        startedAt,
        completedAt,
        error: safeFailure("api_failed"),
      };
      this.#setState(state);
      return state;
    }

    const failures = result.failures.map(({ stream, code }) => ({
      stream,
      ...safeFailure(code),
    }));
    const state: GitHubSyncState = {
      status: failures.length === 0 ? "succeeded" : "partial",
      startedAt,
      completedAt,
      insertedEvents: inserted.inserted,
      ignoredEvents: inserted.ignored,
      repositories: result.repositories.length,
      failures,
    };
    this.#setState(state);
    return state;
  }

  #recordCoverage(result: GitHubCollectionResult, completedAt: string): void {
    for (const stream of STREAMS) {
      const collected = result.coverage.find((item) => item.stream === stream);
      const failures = result.failures.filter((failure) => failure.stream === stream);
      const existing = this.storage.getCoverage(coverageKey(stream), this.now());
      const completeness: Completeness = collected?.completeness ?? "unavailable";
      const succeeded = collected !== undefined && completeness !== "unavailable";
      const safeErrors = [...new Set(failures.map(({ code }) => SAFE_FAILURE_MESSAGES[code]))];

      this.storage.upsertCoverage(
        {
          coverageKey: coverageKey(stream),
          sourceId: GITHUB_SOURCE_ID,
          metric: stream,
          completeness,
          ...(collected?.coverageStart === undefined
            ? existing?.coverageStart === undefined
              ? {}
              : { coverageStart: existing.coverageStart }
            : { coverageStart: collected.coverageStart }),
          ...(collected?.coverageEnd === undefined ? {} : { coverageEnd: collected.coverageEnd }),
          coverageReason: collected?.reason ?? "GitHub stream could not be collected",
          lastAttemptedAt: completedAt,
          ...(succeeded
            ? { lastSucceededAt: collected.observedAt }
            : existing?.lastSucceededAt === undefined
              ? {}
              : { lastSucceededAt: existing.lastSucceededAt }),
          ...(safeErrors.length === 0 ? {} : { latestError: safeErrors.join("; ") }),
          expectedSyncIntervalMs: EXPECTED_SYNC_INTERVAL_MS,
        },
        completedAt,
      );
    }
  }

  #setState(state: GitHubSyncState): void {
    this.#state = state;
    this.events.publish({ event: "github-sync", data: { ...state } });
  }
}
