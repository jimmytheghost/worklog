import type { GitHubCollectionResult } from "@agent-dashboard/collector-github";
import type { AnyNormalizedEvent } from "@agent-dashboard/domain";
import { openStorage, type Storage } from "@agent-dashboard/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { ServiceEventHub } from "../src/events.js";
import { GITHUB_SOURCE_ID } from "../src/github-sync.js";

const observedAt = "2026-08-31T12:00:00.000Z";
const now = () => new Date(observedAt);
const apps: ReturnType<typeof buildApp>[] = [];
const stores: Storage[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const storage of stores.splice(0)) storage.close();
});

function storage(): Storage {
  const created = openStorage({ filename: ":memory:" });
  stores.push(created);
  return created;
}

function event(
  eventType: "repository.discovered" | "git.commit.discovered" | "github.push.observed",
): AnyNormalizedEvent {
  const shared = {
    schemaVersion: 1,
    repositoryId: "github:1001",
    sourceSystem: "github" as const,
    sourceAccountId: "42",
    adapterName: "github-gh-api",
    adapterVersion: "0.0.0",
    observedAt,
    confidence: "unknown" as const,
    attribution: "unknown" as const,
  };

  if (eventType === "repository.discovered") {
    return {
      ...shared,
      eventId: "github.repository:1001",
      eventType,
      entityType: "repository",
      entityId: "github:1001",
      occurredAt: "2026-01-01T12:00:00.000Z",
      occurredAtSource: "source",
      sourceRecordId: "1001",
      idempotencyKey: "github.repository:1001",
      completeness: "complete",
      payload: {
        repositoryKey: "github:1001",
        name: "agent-dashboard",
        owner: "JimmyTheGhost",
        visibility: "private",
      },
    };
  }

  if (eventType === "git.commit.discovered") {
    return {
      ...shared,
      eventId: "git.commit:github:1001:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      eventType,
      entityType: "commit",
      entityId: "github:1001:commit:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      occurredAt: "2026-08-30T18:00:00.000Z",
      occurredAtSource: "source",
      sourceRecordId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      idempotencyKey: "git.commit:github:1001:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      completeness: "partial",
      payload: {
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        committerOccurredAt: "2026-08-30T18:00:00.000Z",
        parentShas: [],
      },
    };
  }

  return {
    ...shared,
    eventId: "github.push:42:push-1",
    eventType,
    entityType: "push",
    entityId: "42:github-event:push-1",
    occurredAt: "2026-08-30T18:05:00.000Z",
    occurredAtSource: "source",
    sourceRecordId: "push-1",
    idempotencyKey: "github.push:42:push-1",
    completeness: "partial",
    payload: {
      ref: "refs/heads/main",
      commitShas: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      membershipComplete: false,
    },
  };
}

function result(overrides: Partial<GitHubCollectionResult> = {}): GitHubCollectionResult {
  return {
    account: { id: "42", login: "JimmyTheGhost" },
    repositories: [
      {
        id: "1001",
        repositoryId: "github:1001",
        name: "agent-dashboard",
        fullName: "JimmyTheGhost/agent-dashboard",
        owner: "JimmyTheGhost",
        defaultBranch: "main",
        visibility: "private",
        isPrivate: true,
        createdAt: "2026-01-01T12:00:00.000Z",
        updatedAt: "2026-08-30T18:05:00.000Z",
      },
    ],
    events: [
      event("repository.discovered"),
      event("git.commit.discovered"),
      event("github.push.observed"),
    ],
    coverage: [
      {
        stream: "repositories",
        completeness: "complete",
        source: "github_rest_v3",
        endpoint: "GET /user/repos",
        observedAt,
        reason: "Owned repository discovery complete",
      },
      {
        stream: "commits",
        completeness: "partial",
        source: "github_rest_v3",
        endpoint: "GET /repos/{owner}/{repo}/commits",
        observedAt,
        coverageStart: "2026-08-30T18:00:00.000Z",
        coverageEnd: "2026-08-30T18:00:00.000Z",
        reason: "Default branches only",
      },
      {
        stream: "pushes",
        completeness: "partial",
        source: "github_rest_v3",
        endpoint: "GET /users/{username}/events",
        observedAt,
        coverageStart: "2026-08-30T18:05:00.000Z",
        coverageEnd: "2026-08-30T18:05:00.000Z",
        reason: "Recent observations only",
      },
    ],
    failures: [],
    ...overrides,
  };
}

class FixtureCollector {
  calls = 0;

  constructor(private readonly value: GitHubCollectionResult) {}

  async collect(): Promise<GitHubCollectionResult> {
    this.calls += 1;
    return this.value;
  }
}

function integratedApp(store: Storage, collector: FixtureCollector, eventHub?: ServiceEventHub) {
  const app = buildApp({
    storage: store,
    githubCollector: collector,
    fixtureMode: false,
    timeZone: "America/Denver",
    now,
    ...(eventHub === undefined ? {} : { eventHub }),
  });
  apps.push(app);
  return app;
}

describe("GitHub service integration", () => {
  it("starts listening while startup synchronization is still pending and publishes its terminal state", async () => {
    const store = storage();
    const eventHub = new ServiceEventHub();
    const states: Array<Record<string, unknown>> = [];
    eventHub.subscribe(({ event, data }) => {
      if (event === "github-sync") states.push(data);
    });
    let resolveCollection: ((value: GitHubCollectionResult) => void) | undefined;
    const pendingCollection = new Promise<GitHubCollectionResult>((resolve) => {
      resolveCollection = resolve;
    });
    const app = buildApp({
      storage: store,
      githubCollector: { collect: () => pendingCollection },
      githubSyncOnStart: true,
      fixtureMode: false,
      eventHub,
      now,
    });
    apps.push(app);

    await app.listen({ host: "127.0.0.1", port: 0 });

    expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
      githubSync: "running",
    });
    expect(states.map(({ status }) => status)).toEqual(["running"]);

    resolveCollection?.(result());
    await expect.poll(() => states.at(-1)?.status).toBe("succeeded");

    expect(states.map(({ status }) => status)).toEqual(["running", "succeeded"]);
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
      githubSync: "succeeded",
    });
  });

  it("persists a first sync and emits sanitized sync state", async () => {
    const store = storage();
    const collector = new FixtureCollector(result());
    const eventHub = new ServiceEventHub();
    const states: Array<Record<string, unknown>> = [];
    eventHub.subscribe(({ data }) => states.push(data));
    const app = integratedApp(store, collector, eventHub);

    const response = await app.inject({ method: "POST", url: "/api/sync/github" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "succeeded",
      insertedEvents: 3,
      ignoredEvents: 0,
      repositories: 1,
    });
    expect(store.countEvents()).toBe(3);
    expect(store.listProjects()).toEqual([
      expect.objectContaining({ id: "github:1001", name: "agent-dashboard" }),
    ]);
    expect(states.map(({ status }) => status)).toEqual(["running", "succeeded"]);
  });

  it("is idempotent when the same collection result is synchronized twice", async () => {
    const store = storage();
    const collector = new FixtureCollector(result());
    const app = integratedApp(store, collector);

    await app.inject({ method: "POST", url: "/api/sync/github" });
    const repeated = await app.inject({ method: "POST", url: "/api/sync/github" });

    expect(repeated.json()).toMatchObject({ insertedEvents: 0, ignoredEvents: 3 });
    expect(store.countEvents()).toBe(3);
    expect(collector.calls).toBe(2);
  });

  it("records partial coverage with allowlisted errors and never stores collector stderr", async () => {
    const store = storage();
    const partial = result({
      failures: [
        {
          stream: "commits",
          code: "api_failed",
          message: "stderr contained SECRET_TOKEN and /private/path",
          repositoryId: "github:1001",
        },
      ],
    });
    const app = integratedApp(store, new FixtureCollector(partial));

    const response = await app.inject({ method: "POST", url: "/api/sync/github" });
    const coverage = store.getCoverage(`${GITHUB_SOURCE_ID}:commits`, now());

    expect(response.json()).toMatchObject({
      status: "partial",
      failures: [{ stream: "commits", code: "api_failed", message: "GitHub API request failed" }],
    });
    expect(coverage).toMatchObject({
      completeness: "partial",
      latestError: "GitHub API request failed",
    });
    expect(JSON.stringify({ body: response.body, coverage })).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify({ body: response.body, coverage })).not.toContain("/private/path");
  });

  it("builds a live 12-month snapshot from stored projects, events, and coverage", async () => {
    const store = storage();
    const app = integratedApp(store, new FixtureCollector(result()));
    await app.inject({ method: "POST", url: "/api/sync/github" });

    const response = await app.inject({ method: "GET", url: "/api/snapshot" });
    const snapshot = response.json();

    expect(response.statusCode).toBe(200);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      timezone: "America/Denver",
      projects: [expect.objectContaining({ name: "agent-dashboard", branch: "main", commits: 1 })],
      agents: [],
    });
    expect(snapshot.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "commits", value: 1, completeness: "partial" }),
        expect.objectContaining({ metric: "pushes", value: 1, completeness: "partial" }),
        expect.objectContaining({ metric: "active_projects", value: 1, completeness: "partial" }),
        expect.objectContaining({ metric: "codex_observed_tokens", value: null }),
      ]),
    );
    expect(snapshot.activityDays).toHaveLength(365);
    expect(snapshot.recentActivity[0]).toMatchObject({
      eventType: "github.push.observed",
      projectId: "github:1001",
    });
  });

  it("represents an empty database as unavailable rather than confirmed zero", async () => {
    const store = storage();
    const app = buildApp({
      storage: store,
      fixtureMode: false,
      timeZone: "America/Denver",
      now,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/snapshot" });
    const snapshot = response.json();

    expect(snapshot.activityDays).toEqual([]);
    expect(snapshot.projects).toEqual([]);
    expect(snapshot.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "commits", value: null, completeness: "unavailable" }),
        expect.objectContaining({ metric: "pushes", value: null, completeness: "unavailable" }),
      ]),
    );
    expect(snapshot.sources[0]).toMatchObject({
      sourceSystem: "github",
      status: "not_configured",
      freshness: "never",
    });
  });
});
