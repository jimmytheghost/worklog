import type {
  GitHubCollectionResult,
  GitHubRepository,
} from "@agent-dashboard/collector-github";
import {
  commitIdempotencyKey,
  githubPushIdempotencyKey,
  parseNormalizedEvent,
  repositoryIdempotencyKey,
  type AnyNormalizedEvent,
} from "@agent-dashboard/domain";
import { openStorage, type Storage } from "@agent-dashboard/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const ACCOUNT = { id: "42", login: "JimmyTheGhost" } as const;
const OBSERVED_AT = "2026-08-31T20:00:00.000Z";
const now = () => new Date(OBSERVED_AT);
const apps: ReturnType<typeof buildApp>[] = [];
const stores: Storage[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const storage of stores.splice(0)) storage.close();
});

function openTestStorage(): Storage {
  const storage = openStorage({ filename: ":memory:" });
  stores.push(storage);
  return storage;
}

function repository(id: string, name: string): GitHubRepository {
  return {
    id,
    repositoryId: `github:${id}`,
    name,
    fullName: `${ACCOUNT.login}/${name}`,
    owner: ACCOUNT.login,
    defaultBranch: "main",
    visibility: "private",
    isPrivate: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: OBSERVED_AT,
  };
}

function repositoryEvent(repo: GitHubRepository): AnyNormalizedEvent {
  const idempotencyKey = repositoryIdempotencyKey("github", repo.id);
  return parseNormalizedEvent({
    eventId: idempotencyKey,
    eventType: "repository.discovered",
    schemaVersion: 1,
    entityType: "repository",
    entityId: repo.repositoryId,
    repositoryId: repo.repositoryId,
    occurredAt: repo.createdAt,
    occurredAtSource: "source",
    observedAt: OBSERVED_AT,
    sourceSystem: "github",
    sourceAccountId: ACCOUNT.id,
    sourceRecordId: repo.id,
    adapterName: "github-acceptance-fixture",
    adapterVersion: "1.0.0",
    sourceFormatVersion: "acceptance-v1",
    idempotencyKey,
    attribution: "unknown",
    confidence: "unknown",
    completeness: "complete",
    payload: {
      repositoryKey: repo.repositoryId,
      name: repo.name,
      owner: repo.owner,
      visibility: repo.visibility,
    },
  });
}

function sha(repoId: string, index: number): string {
  const seed = (Number(repoId) * 10_000 + index).toString(16);
  return seed.padStart(40, "a").slice(-40);
}

function commitEvent(repo: GitHubRepository, index: number, occurredAt: string): AnyNormalizedEvent {
  const commitSha = sha(repo.id, index);
  const idempotencyKey = commitIdempotencyKey(repo.repositoryId, commitSha);
  return parseNormalizedEvent({
    eventId: idempotencyKey,
    eventType: "git.commit.discovered",
    schemaVersion: 1,
    entityType: "commit",
    entityId: `${repo.repositoryId}:commit:${commitSha}`,
    repositoryId: repo.repositoryId,
    occurredAt,
    occurredAtSource: "source",
    observedAt: OBSERVED_AT,
    sourceSystem: "github",
    sourceAccountId: ACCOUNT.id,
    sourceRecordId: commitSha,
    adapterName: "github-acceptance-fixture",
    adapterVersion: "1.0.0",
    sourceFormatVersion: "acceptance-v1",
    idempotencyKey,
    attribution: "unknown",
    confidence: "unknown",
    completeness: "partial",
    payload: { sha: commitSha, committerOccurredAt: occurredAt, parentShas: [] },
  });
}

function pushEvent(
  repo: GitHubRepository,
  index: number,
  occurredAt: string,
  ref = "refs/heads/feature/agent-metrics",
): AnyNormalizedEvent {
  const sourceRecordId = `${repo.id}-push-${index}`;
  const idempotencyKey = githubPushIdempotencyKey(ACCOUNT.id, sourceRecordId);
  return parseNormalizedEvent({
    eventId: idempotencyKey,
    eventType: "github.push.observed",
    schemaVersion: 1,
    entityType: "push",
    entityId: `${ACCOUNT.id}:github-event:${sourceRecordId}`,
    repositoryId: repo.repositoryId,
    occurredAt,
    occurredAtSource: "source",
    observedAt: OBSERVED_AT,
    sourceSystem: "github",
    sourceAccountId: ACCOUNT.id,
    sourceRecordId,
    adapterName: "github-acceptance-fixture",
    adapterVersion: "1.0.0",
    sourceFormatVersion: "acceptance-v1",
    idempotencyKey,
    attribution: "unknown",
    confidence: "unknown",
    completeness: "partial",
    payload: {
      ref,
      commitShas: [sha(repo.id, index)],
      membershipComplete: false,
    },
  });
}

function collection(
  repositories: GitHubRepository[],
  counts: ReadonlyMap<string, { commits: number; pushes: number }>,
): GitHubCollectionResult {
  const events: AnyNormalizedEvent[] = repositories.map(repositoryEvent);
  for (const repo of repositories) {
    const repoCounts = counts.get(repo.id) ?? { commits: 0, pushes: 0 };
    for (let index = 1; index <= repoCounts.commits; index += 1) {
      events.push(commitEvent(repo, index, `2026-08-31T16:00:${String(index).padStart(2, "0")}.000Z`));
    }
    for (let index = 1; index <= repoCounts.pushes; index += 1) {
      events.push(pushEvent(repo, index, `2026-08-31T17:00:${String(index).padStart(2, "0")}.000Z`));
    }
  }

  return {
    account: ACCOUNT,
    repositories,
    events,
    coverage: [
      {
        stream: "repositories",
        completeness: "complete",
        source: "github_rest_v3",
        endpoint: "GET /user/repos",
        observedAt: OBSERVED_AT,
        reason: "Acceptance fixture repository coverage",
      },
      {
        stream: "commits",
        completeness: "partial",
        source: "github_rest_v3",
        endpoint: "GET /repos/{owner}/{repo}/commits",
        observedAt: OBSERVED_AT,
        coverageStart: "2026-08-31T06:00:00.000Z",
        coverageEnd: OBSERVED_AT,
        reason: "Acceptance fixture commit coverage",
      },
      {
        stream: "pushes",
        completeness: "partial",
        source: "github_rest_v3",
        endpoint: "GET /users/{username}/events",
        observedAt: OBSERVED_AT,
        coverageStart: "2026-08-31T06:00:00.000Z",
        coverageEnd: OBSERVED_AT,
        reason: "Acceptance fixture push coverage",
      },
    ],
    failures: [],
  };
}

class InjectedCollector {
  constructor(private readonly result: GitHubCollectionResult) {}

  async collect(): Promise<GitHubCollectionResult> {
    return this.result;
  }
}

function appFor(result: GitHubCollectionResult) {
  const app = buildApp({
    storage: openTestStorage(),
    githubCollector: new InjectedCollector(result),
    fixtureMode: false,
    timeZone: "America/Denver",
    now,
  });
  apps.push(app);
  return app;
}

function metric(snapshot: { summary: Array<{ metric: string; value: number | null }> }, name: string) {
  return snapshot.summary.find((candidate) => candidate.metric === name)?.value;
}

describe("GitHub count acceptance", () => {
  it("reports 19 commits and 19 non-default-branch pushes on one Denver-local day", async () => {
    const repo = repository("1001", "agent-dashboard");
    const app = appFor(collection([repo], new Map([[repo.id, { commits: 19, pushes: 19 }]])));

    const firstSync = await app.inject({ method: "POST", url: "/api/sync/github" });
    const snapshotResponse = await app.inject({ method: "GET", url: "/api/snapshot" });
    const repeatedSync = await app.inject({ method: "POST", url: "/api/sync/github" });
    const snapshot = snapshotResponse.json();
    const today = snapshot.activityDays.find((day: { date: string }) => day.date === "2026-08-31");

    expect(firstSync.statusCode).toBe(200);
    expect(firstSync.json()).toMatchObject({ insertedEvents: 39, ignoredEvents: 0 });
    expect(metric(snapshot, "commits")).toBe(19);
    expect(metric(snapshot, "pushes")).toBe(19);
    expect(today).toMatchObject({ commits: 19, pushes: 19 });
    expect(repeatedSync.json()).toMatchObject({ insertedEvents: 0, ignoredEvents: 39 });
  });

  it("aggregates account-wide commit and push totals independently across repositories", async () => {
    const dashboard = repository("1001", "agent-dashboard");
    const toolkit = repository("1002", "agentic-toolkit");
    const app = appFor(
      collection(
        [dashboard, toolkit],
        new Map([
          [dashboard.id, { commits: 3, pushes: 2 }],
          [toolkit.id, { commits: 4, pushes: 7 }],
        ]),
      ),
    );

    await app.inject({ method: "POST", url: "/api/sync/github" });
    const snapshot = (await app.inject({ method: "GET", url: "/api/snapshot" })).json();

    expect(metric(snapshot, "commits")).toBe(7);
    expect(metric(snapshot, "pushes")).toBe(9);
    expect(snapshot.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: dashboard.repositoryId, commits: 3 }),
        expect.objectContaining({ projectId: toolkit.repositoryId, commits: 4 }),
      ]),
    );
    expect(snapshot.activityDays.find((day: { date: string }) => day.date === "2026-08-31")).toMatchObject({
      commits: 7,
      pushes: 9,
    });
  });
});
