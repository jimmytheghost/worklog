import { deduplicateEvents, type AnyNormalizedEvent } from "@agent-dashboard/domain";

import { GhApiClient } from "./client.js";
import { collectionFailure, GitHubCollectorError } from "./errors.js";
import {
  branchName,
  normalizeCommit,
  normalizeRepositoryActivity,
  normalizeRepository,
  type GitHubBranchRecord,
  type GitHubCommitRecord,
  type GitHubRepositoryActivityRecord,
  type GitHubRepositoryRecord,
} from "./normalize.js";
import { ExecFileCommandRunner } from "./runner.js";
import type {
  CollectionBatch,
  CollectionCoverage,
  GitHubAccount,
  GitHubCollectionResult,
  GitHubCollectorOptions,
  GitHubRepository,
} from "./types.js";

interface GitHubAccountRecord {
  id?: unknown;
  login?: unknown;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function dateRange(events: readonly AnyNormalizedEvent[]): Pick<CollectionCoverage, "coverageStart" | "coverageEnd"> {
  if (events.length === 0) return {};
  const dates = events.map((event) => event.occurredAt).sort();
  return { coverageStart: dates[0]!, coverageEnd: dates.at(-1)! };
}

export class GitHubCollector {
  private readonly client: GhApiClient;
  private readonly now: () => Date;

  constructor(options: GitHubCollectorOptions = {}) {
    this.client = new GhApiClient(options.runner ?? new ExecFileCommandRunner(), options.ghCommand);
    this.now = options.now ?? (() => new Date());
  }

  async getAuthenticatedAccount(): Promise<GitHubAccount> {
    const record = await this.client.get<GitHubAccountRecord>("user");
    if (
      (typeof record.id !== "number" && typeof record.id !== "string") ||
      typeof record.login !== "string" ||
      record.login.length === 0
    ) {
      throw new GitHubCollectorError("malformed_response", "GitHub returned an invalid account");
    }
    return { id: String(record.id), login: record.login };
  }

  async discoverOwnedRepositories(account: GitHubAccount): Promise<{
    repositories: GitHubRepository[];
    batch: CollectionBatch;
  }> {
    const observedAt = this.now().toISOString();
    const records = await this.client.getPaginated<GitHubRepositoryRecord>(
      "user/repos?affiliation=owner&visibility=all&sort=full_name&direction=asc&per_page=100",
    );
    const normalized = records.map((record) => normalizeRepository(record, account, observedAt));
    const events = deduplicateEvents(normalized.map(({ event }) => event));
    return {
      repositories: normalized.map(({ repository }) => repository),
      batch: {
        events,
        coverage: {
          stream: "repositories",
          completeness: "complete",
          source: "github_rest_v3",
          endpoint: "GET /user/repos",
          observedAt,
          reason: "Complete for owned repositories visible to the current gh authentication",
          ...dateRange(events),
        },
      },
    };
  }

  async importAllBranchCommits(
    account: GitHubAccount,
    repositories: readonly GitHubRepository[],
  ): Promise<{ batch: CollectionBatch; failures: GitHubCollectionResult["failures"] }> {
    const observedAt = this.now().toISOString();
    const events: AnyNormalizedEvent[] = [];
    const failures: GitHubCollectionResult["failures"] = [];

    for (const repository of repositories) {
      const repositoryEndpoint = `repos/${encodePath(repository.owner)}/${encodePath(repository.name)}`;
      let branches: GitHubBranchRecord[];
      try {
        branches = await this.client.getPaginated<GitHubBranchRecord>(`${repositoryEndpoint}/branches?per_page=100`);
      } catch (error) {
        failures.push(collectionFailure(error, "commits", repository.repositoryId));
        continue;
      }

      for (const branch of branches) {
        try {
          const name = branchName(branch);
          const endpoint = `${repositoryEndpoint}/commits?sha=${encodeURIComponent(name)}&author=${encodeURIComponent(account.login)}&per_page=100`;
          const records = await this.client.getPaginated<GitHubCommitRecord>(endpoint);
          events.push(...records.map((record) => normalizeCommit(record, repository, account, observedAt)));
        } catch (error) {
          failures.push(collectionFailure(error, "commits", repository.repositoryId));
        }
      }
    }

    const uniqueEvents = deduplicateEvents(events);
    return {
      batch: {
        events: uniqueEvents,
        coverage: {
          stream: "commits",
          completeness: "partial",
          source: "github_rest_v3",
          endpoint: "GET /repos/{owner}/{repo}/branches + GET /repos/{owner}/{repo}/commits",
          observedAt,
          reason:
            failures.length === 0
              ? "Author-filtered commits reachable from every live repository branch; duplicate SHAs across branches are counted once"
              : `All-branch commit import completed with ${failures.length} failed branch or repository request(s)`,
          ...dateRange(uniqueEvents),
        },
      },
      failures,
    };
  }

  /** @deprecated Use importAllBranchCommits. Retained for API compatibility. */
  async importDefaultBranchCommits(
    account: GitHubAccount,
    repositories: readonly GitHubRepository[],
  ): Promise<{ batch: CollectionBatch; failures: GitHubCollectionResult["failures"] }> {
    return await this.importAllBranchCommits(account, repositories);
  }

  async importRepositoryPushActivity(
    account: GitHubAccount,
    repositories: readonly GitHubRepository[],
  ): Promise<{ batch: CollectionBatch; failures: GitHubCollectionResult["failures"] }> {
    const observedAt = this.now().toISOString();
    const events: AnyNormalizedEvent[] = [];
    const failures: GitHubCollectionResult["failures"] = [];

    for (const repository of repositories) {
      const endpoint = `repos/${encodePath(repository.owner)}/${encodePath(repository.name)}/activity?time_period=year&per_page=100`;
      try {
        const records = await this.client.getPaginated<GitHubRepositoryActivityRecord>(endpoint);
        events.push(
          ...records
            .map((record) => normalizeRepositoryActivity(record, repository, account, observedAt))
            .filter((event): event is NonNullable<typeof event> => event !== undefined),
        );
      } catch (error) {
        failures.push(collectionFailure(error, "pushes", repository.repositoryId));
      }
    }

    const uniqueEvents = deduplicateEvents(events);
    return {
      batch: {
        events: uniqueEvents,
        coverage: {
          stream: "pushes",
          completeness: "partial",
          source: "github_rest_v3",
          endpoint: "GET /repos/{owner}/{repo}/activity",
          observedAt,
          reason:
            failures.length === 0
              ? "One year of repository push, force-push, branch-creation, and branch-deletion activity by the authenticated account"
              : `Repository push activity completed with ${failures.length} failed repository request(s)`,
          ...dateRange(uniqueEvents),
        },
      },
      failures,
    };
  }

  async importRecentPushObservations(
    account: GitHubAccount,
    repositories: readonly GitHubRepository[],
  ): Promise<CollectionBatch> {
    return (await this.importRepositoryPushActivity(account, repositories)).batch;
  }

  async collect(): Promise<GitHubCollectionResult> {
    const account = await this.getAuthenticatedAccount();
    const discovered = await this.discoverOwnedRepositories(account);
    const commits = await this.importAllBranchCommits(account, discovered.repositories);
    const coverage = [discovered.batch.coverage, commits.batch.coverage];
    const failures = [...commits.failures];
    let pushEvents: AnyNormalizedEvent[] = [];

    try {
      const pushes = await this.importRepositoryPushActivity(account, discovered.repositories);
      pushEvents = pushes.batch.events;
      coverage.push(pushes.batch.coverage);
      failures.push(...pushes.failures);
    } catch (error) {
      failures.push(collectionFailure(error, "pushes"));
      coverage.push({
        stream: "pushes",
        completeness: "unavailable",
        source: "github_rest_v3",
        endpoint: "GET /repos/{owner}/{repo}/activity",
        observedAt: this.now().toISOString(),
        reason: "Repository push activity could not be collected",
      });
    }

    return {
      account,
      repositories: discovered.repositories,
      events: deduplicateEvents([
        ...discovered.batch.events,
        ...commits.batch.events,
        ...pushEvents,
      ]),
      coverage,
      failures,
    };
  }
}
