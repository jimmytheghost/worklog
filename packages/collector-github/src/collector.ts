import { createHash } from "node:crypto";
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
  GitHubCollectionInput,
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

function normalizeSince(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/(?:Z|\+00:00)$/i.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new GitHubCollectorError("invalid_input", "GitHub collection since must be a valid UTC instant");
  }
  return new Date(value).toISOString();
}

function dateRange(events: readonly AnyNormalizedEvent[]): Pick<CollectionCoverage, "coverageStart" | "coverageEnd"> {
  if (events.length === 0) return {};
  const dates = events.map((event) => event.occurredAt).sort();
  return { coverageStart: dates[0]!, coverageEnd: dates.at(-1)! };
}

// Bound network concurrency without skipping any repositories or branches.
async function forEachRepository<T>(items: readonly T[], visit: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await visit(item);
    }
  }));
}

export class GitHubCollector {
  private readonly client: GhApiClient;
  private readonly now: () => Date;
  private readonly authorEmails = new Map<string, Set<string>>();
  readonly identityKey: string;

  constructor(options: GitHubCollectorOptions = {}) {
    this.client = new GhApiClient(options.runner ?? new ExecFileCommandRunner(), options.ghCommand);
    this.now = options.now ?? (() => new Date());
    for (const identity of options.authorIdentities ?? []) {
      const emails = this.authorEmails.get(identity.accountId) ?? new Set<string>();
      emails.add(identity.email.trim().toLowerCase());
      this.authorEmails.set(identity.accountId, emails);
    }
    // Persist only a fingerprint in the cursor, so adding an alias backfills
    // history once without retaining author email addresses in the ledger.
    const identities = [...this.authorEmails].flatMap(([id, emails]) => [...emails].map((email) => [id, email])).sort();
    this.identityKey = createHash("sha256").update(JSON.stringify(identities)).digest("hex");
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

  async discoverRepositories(account: GitHubAccount): Promise<{
    repositories: GitHubRepository[];
    batch: CollectionBatch;
  }> {
    const observedAt = this.now().toISOString();
    const records = await this.client.getPaginated<GitHubRepositoryRecord>(
      "user/repos?affiliation=owner,collaborator,organization_member&visibility=all&sort=full_name&direction=asc&per_page=100",
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
          reason: "Complete for owned, collaborator, and organization-member repositories visible to the current gh authentication",
          ...dateRange(events),
        },
      },
    };
  }

  /** @deprecated Use discoverRepositories. Retained for API compatibility. */
  async discoverOwnedRepositories(account: GitHubAccount): Promise<{
    repositories: GitHubRepository[];
    batch: CollectionBatch;
  }> {
    return await this.discoverRepositories(account);
  }

  async importAllBranchCommits(
    account: GitHubAccount,
    repositories: readonly GitHubRepository[],
    input: GitHubCollectionInput = {},
  ): Promise<{ batch: CollectionBatch; failures: GitHubCollectionResult["failures"] }> {
    const since = normalizeSince(input.since);
    const observedAt = this.now().toISOString();
    const events: AnyNormalizedEvent[] = [];
    const failures: GitHubCollectionResult["failures"] = [];

    await forEachRepository(repositories, async (repository) => {
      const repositoryEndpoint = `repos/${encodePath(repository.owner)}/${encodePath(repository.name)}`;
      let branches: GitHubBranchRecord[];
      try {
        branches = await this.client.getPaginated<GitHubBranchRecord>(`${repositoryEndpoint}/branches?per_page=100`);
      } catch (error) {
        failures.push(collectionFailure(error, "commits", repository.repositoryId));
        return;
      }

      for (const branch of branches) {
        try {
          const name = branchName(branch);
          // GitHub's username author filter can omit commits made with a linked
          // noreply address. Match the returned immutable account ID locally.
          const endpoint = `${repositoryEndpoint}/commits?sha=${encodeURIComponent(name)}&per_page=100${since === undefined ? "" : `&since=${encodeURIComponent(since)}`}`;
          const records = await this.client.getPaginated<GitHubCommitRecord>(endpoint);
          events.push(...records
            .filter((record) => {
              if (record.author?.id !== undefined && record.author.id !== null) {
                return String(record.author.id) === account.id;
              }
              const email = record.commit?.author?.email;
              return typeof email === "string" && this.authorEmails.get(account.id)?.has(email.trim().toLowerCase());
            })
            .map((record) => normalizeCommit(record, repository, account, observedAt)));
        } catch (error) {
          failures.push(collectionFailure(error, "commits", repository.repositoryId));
        }
      }
    });

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
              ? since === undefined
                ? "Commits matching the authenticated account ID or its configured author emails from every live repository branch; duplicate SHAs across branches are counted once; unmatched authors are excluded"
                : `Commits since ${since} matching the authenticated account ID or its configured author emails from every live repository branch; duplicate SHAs across branches are counted once; unmatched authors are excluded`
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
    input: GitHubCollectionInput = {},
  ): Promise<{ batch: CollectionBatch; failures: GitHubCollectionResult["failures"] }> {
    return await this.importAllBranchCommits(account, repositories, input);
  }

  async importRepositoryPushActivity(
    account: GitHubAccount,
    repositories: readonly GitHubRepository[],
    input: GitHubCollectionInput = {},
  ): Promise<{ batch: CollectionBatch; failures: GitHubCollectionResult["failures"] }> {
    const since = normalizeSince(input.since);
    const sinceMilliseconds = since === undefined ? undefined : Date.parse(since);
    const observedAt = this.now().toISOString();
    const events: AnyNormalizedEvent[] = [];
    const failures: GitHubCollectionResult["failures"] = [];

    await forEachRepository(repositories, async (repository) => {
      const endpoint = `repos/${encodePath(repository.owner)}/${encodePath(repository.name)}/activity?time_period=year&per_page=100`;
      try {
        const records = await this.client.getPaginated<GitHubRepositoryActivityRecord>(endpoint);
        events.push(
          ...records
            .map((record) => normalizeRepositoryActivity(record, repository, account, observedAt))
            .filter((event): event is NonNullable<typeof event> => event !== undefined)
            .filter(
              (event) =>
                sinceMilliseconds === undefined || Date.parse(event.occurredAt) >= sinceMilliseconds,
            ),
        );
      } catch (error) {
        failures.push(collectionFailure(error, "pushes", repository.repositoryId));
      }
    });

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
              ? since === undefined
                ? "One year of repository push, force-push, branch-creation, and branch-deletion activity by the authenticated account"
                : `Repository push, force-push, branch-creation, and branch-deletion activity by the authenticated account since ${since}`
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
    input: GitHubCollectionInput = {},
  ): Promise<CollectionBatch> {
    return (await this.importRepositoryPushActivity(account, repositories, input)).batch;
  }

  async collect(input: GitHubCollectionInput = {}): Promise<GitHubCollectionResult> {
    const since = normalizeSince(input.since);
    const incrementalInput: GitHubCollectionInput = since === undefined ? {} : { since };
    const account = await this.getAuthenticatedAccount();
    const discovered = await this.discoverRepositories(account);
    const commits = await this.importAllBranchCommits(account, discovered.repositories, incrementalInput);
    const coverage = [discovered.batch.coverage, commits.batch.coverage];
    const failures = [...commits.failures];
    let pushEvents: AnyNormalizedEvent[] = [];

    try {
      const pushes = await this.importRepositoryPushActivity(account, discovered.repositories, incrementalInput);
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
