import { describe, expect, it } from "vitest";

import accountFixture from "./fixtures/account.json";
import branchesFixture from "./fixtures/branches-pages.json";
import commitsFixture from "./fixtures/commits-pages.json";
import activityFixture from "./fixtures/repository-activity-pages.json";
import repositoriesFixture from "./fixtures/repositories-pages.json";
import {
  GitHubCollector,
  GitHubCollectorError,
  githubRepositoryId,
  isPrivacySafeGitHubEvent,
  normalizeCommit,
  normalizePush,
  type CommandResult,
  type CommandRunner,
} from "../src/index.js";

class FixtureRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];

  constructor(
    private readonly respond: (
      command: string,
      args: readonly string[],
    ) => CommandResult | Promise<CommandResult>,
  ) {}

  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return await this.respond(command, args);
  }
}

const success = (value: unknown): CommandResult => ({
  stdout: JSON.stringify(value),
  stderr: "",
  exitCode: 0,
});

const now = () => new Date("2026-08-31T12:00:00Z");

function endpoint(args: readonly string[]): string {
  return args.find((arg) => /^(user|users\/|repos\/)/.test(arg)) ?? "";
}

describe("GitHubCollector", () => {
  it("discovers paginated owner, collaborator, and organization repositories with stable IDs", async () => {
    const runner = new FixtureRunner((_command, args) => {
      if (endpoint(args) === "user") return success(accountFixture);
      return success(repositoriesFixture);
    });
    const collector = new GitHubCollector({ runner, now });
    const account = await collector.getAuthenticatedAccount();
    const discovered = await collector.discoverRepositories(account);

    expect(discovered.repositories.map(({ repositoryId }) => repositoryId)).toEqual([
      "github:1001",
      "github:1002",
    ]);
    expect(discovered.repositories[0]).toMatchObject({ isPrivate: true, visibility: "private" });
    expect(discovered.batch.events[0]?.payload).toMatchObject({
      repositoryKey: "github:1001",
      visibility: "private",
    });
    expect(runner.calls.every(({ command, args }) => command === "gh" && Array.isArray(args))).toBe(true);
    expect(runner.calls[1]?.args).toContain("--paginate");
    expect(runner.calls[1]?.args).toContain("--slurp");
    expect(endpoint(runner.calls[1]!.args)).toContain(
      "affiliation=owner,collaborator,organization_member",
    );
    expect(discovered.batch.coverage.reason).toContain("collaborator");
    expect(discovered.batch.coverage.reason).toContain("organization-member");
  });

  it("imports commits from every live branch, deduplicates shared SHAs, and retains no sensitive data", async () => {
    const runner = new FixtureRunner((_command, args) => {
      const requested = endpoint(args);
      if (requested === "user") return success(accountFixture);
      if (requested.startsWith("user/repos")) return success([repositoriesFixture[0]]);
      if (requested.includes("/branches?")) return success(branchesFixture);
      if (requested.includes("sha=main")) return success([commitsFixture[0]]);
      if (requested.includes("sha=codex%2Fsystem-reset")) return success(commitsFixture);
      return success([[]]);
    });
    const collector = new GitHubCollector({ runner, now });
    const account = await collector.getAuthenticatedAccount();
    const discovered = await collector.discoverRepositories(account);
    const imported = await collector.importAllBranchCommits(account, discovered.repositories);

    expect(imported.batch.events).toHaveLength(2);
    expect(imported.batch.coverage).toMatchObject({ completeness: "partial", stream: "commits" });
    expect(imported.batch.coverage.endpoint).toContain("/branches");
    expect(imported.batch.coverage.reason).toContain("every live repository branch");
    expect(imported.failures).toEqual([]);
    expect(imported.batch.events.every(isPrivacySafeGitHubEvent)).toBe(true);
    expect(JSON.stringify(imported.batch.events)).not.toContain("Body must never enter");
    expect(JSON.stringify(imported.batch.events)).not.toContain("Details remain private");
    expect(JSON.stringify(imported.batch.events)).not.toContain("secret.txt");
    expect(imported.batch.events[0]?.idempotencyKey).toContain("git.commit");
    expect(imported.batch.events[0]).toMatchObject({
      occurredAt: "2026-08-30T02:01:00.000Z",
      payload: {
        subject: "Add incremental GitHub sync",
        url: "https://github.com/JimmyTheGhost/agent-dashboard/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        authorOccurredAt: "2026-08-30T02:00:00.000Z",
        committerOccurredAt: "2026-08-30T02:01:00.000Z",
      },
    });
    expect(runner.calls.some(({ args }) => endpoint(args).includes("sha=codex%2Fsystem-reset"))).toBe(true);
    expect(
      runner.calls
        .map(({ args }) => endpoint(args))
        .filter((requested) => requested.includes("/commits?"))
        .every((requested) => !requested.includes("&since=")),
    ).toBe(true);
  });

  it("walks every repository with at most four concurrent requests", async () => {
    let active = 0;
    let peak = 0;
    const visited: string[] = [];
    const runner = new FixtureRunner(async (_command, args) => {
      const requested = endpoint(args);
      if (requested === "user") return success(accountFixture);
      if (requested.startsWith("user/repos")) return success(repositoriesFixture);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      visited.push(requested);
      active -= 1;
      return success(requested.includes("/branches?") ? [[{ name: "main" }]] : [[]]);
    });
    const collector = new GitHubCollector({ runner, now });
    const account = await collector.getAuthenticatedAccount();
    const discovered = await collector.discoverRepositories(account);
    const repositories = Array.from({ length: 9 }, (_, index) => ({
      ...discovered.repositories[0]!, name: `repo-${index}`, repositoryId: `github:${index}`,
    }));
    const commits = await collector.importAllBranchCommits(account, repositories);
    const pushes = await collector.importRepositoryPushActivity(account, repositories);
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(commits.failures).toEqual([]);
    expect(pushes.failures).toEqual([]);
    expect(visited.filter((value) => value.includes("/branches?"))).toHaveLength(9);
    expect(visited.filter((value) => value.includes("/commits?"))).toHaveLength(9);
    expect(visited.filter((value) => value.includes("/activity?"))).toHaveLength(9);
  });

  it("bounds incremental commit requests and locally filters repository activity", async () => {
    const runner = new FixtureRunner((_command, args) => {
      const requested = endpoint(args);
      if (requested === "user") return success(accountFixture);
      if (requested.startsWith("user/repos")) return success([repositoriesFixture[0]]);
      if (requested.includes("/branches?")) return success(branchesFixture);
      if (requested.includes("/commits?")) return success([[]]);
      if (requested.includes("/activity?")) return success(activityFixture);
      throw new Error(`unexpected endpoint: ${requested}`);
    });
    const collector = new GitHubCollector({ runner, now });
    const since = "2026-08-31T08:02:00+00:00";
    const result = await collector.collect({ since });
    const commitsCoverage = result.coverage.find(({ stream }) => stream === "commits");
    const pushesCoverage = result.coverage.find(({ stream }) => stream === "pushes");
    const pushes = result.events.filter(({ eventType }) => eventType === "github.push.observed");

    const commitRequests = runner.calls
      .map(({ args }) => endpoint(args))
      .filter((requested) => requested.includes("/commits?"));
    expect(commitRequests).toHaveLength(2);
    expect(commitRequests.every((requested) => requested.includes("since=2026-08-31T08%3A02%3A00.000Z"))).toBe(true);
    expect(commitsCoverage?.reason).toContain("since 2026-08-31T08:02:00.000Z");
    expect(pushes.map(({ sourceRecordId }) => sourceRecordId)).toEqual([
      "activity:9002",
      "activity:9005",
    ]);
    expect(pushesCoverage).toMatchObject({
      coverageStart: "2026-08-31T08:02:00.000Z",
      coverageEnd: "2026-08-31T08:04:00.000Z",
    });
    expect(pushesCoverage?.reason).toContain("since 2026-08-31T08:02:00.000Z");
  });

  it("rejects invalid or non-UTC incremental instants before making requests", async () => {
    const runner = new FixtureRunner(() => {
      throw new Error("runner must not be called");
    });
    const collector = new GitHubCollector({ runner, now });

    await expect(collector.collect({ since: "2026-08-31T08:02:00-06:00" })).rejects.toMatchObject({
      code: "invalid_input",
      message: "GitHub collection since must be a valid UTC instant",
    });
    await expect(collector.collect({ since: "2026-08-31T08:02:00-00:00" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(collector.collect({ since: "2026-08-31T08:02:00" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(collector.collect({ since: "not-a-date" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(runner.calls).toEqual([]);
  });

  it("limits commit subjects to one 512-character line and removes URL credentials and tracking data", () => {
    const repository = {
      id: "1001",
      repositoryId: githubRepositoryId("1001"),
      name: "agent-dashboard",
      fullName: "JimmyTheGhost/agent-dashboard",
      owner: "JimmyTheGhost",
      defaultBranch: "main",
      visibility: "private" as const,
      isPrivate: true,
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-31T01:00:00.000Z",
    };
    const subject = `Track token usage ${"x".repeat(600)}`;
    const event = normalizeCommit(
      {
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        html_url:
          "https://user:credential@github.com/JimmyTheGhost/agent-dashboard/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?access_token=secret#diff",
        commit: {
          author: { date: "2026-08-30T02:00:00Z" },
          committer: { date: "2026-08-30T02:01:00Z" },
          message: `${subject}\rA private commit body`,
        },
      },
      repository,
      { id: "42", login: "JimmyTheGhost" },
      now().toISOString(),
    );

    expect(event.payload.subject).toHaveLength(512);
    expect(event.payload.subject).toBe(subject.slice(0, 512));
    expect(event.payload.url).toBe(
      "https://github.com/JimmyTheGhost/agent-dashboard/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(JSON.stringify(event)).not.toContain("private commit body");
    expect(JSON.stringify(event)).not.toContain("access_token");
    expect(isPrivacySafeGitHubEvent(event)).toBe(true);
  });

  it("counts push, force-push, branch creation, and branch deletion activity exactly once", async () => {
    const runner = new FixtureRunner((_command, args) => {
      if (endpoint(args).includes("/activity?")) return success(activityFixture);
      throw new Error("unexpected endpoint");
    });
    const collector = new GitHubCollector({ runner, now });
    const repositories = [
      {
        id: "1001",
        repositoryId: githubRepositoryId("1001"),
        name: "agent-dashboard",
        fullName: "JimmyTheGhost/agent-dashboard",
        owner: "JimmyTheGhost",
        defaultBranch: "main",
        visibility: "private" as const,
        isPrivate: true,
        createdAt: "2026-08-30T01:00:00.000Z",
        updatedAt: "2026-08-31T01:00:00.000Z",
      },
    ];
    const imported = await collector.importRepositoryPushActivity(
      { id: "42", login: "JimmyTheGhost" },
      repositories,
    );

    expect(imported.batch.events).toHaveLength(4);
    expect(imported.failures).toEqual([]);
    expect(imported.batch.events[0]).toMatchObject({
      repositoryId: "github:1001",
      sourceRecordId: "activity:9001",
      completeness: "partial",
      payload: { activityKind: "push", membershipComplete: false, ref: "refs/heads/codex/system-reset" },
    });
    expect(imported.batch.events[1]).toMatchObject({
      sourceRecordId: "activity:9002",
      payload: { activityKind: "force_push", forced: true },
    });
    expect(imported.batch.events[2]).toMatchObject({
      sourceRecordId: "activity:9003",
      payload: {
        activityKind: "branch_creation",
        ref: "refs/heads/codex/system-reset",
        afterSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect(imported.batch.events[2]?.payload).not.toHaveProperty("deleted");
    expect(imported.batch.events[3]).toMatchObject({
      sourceRecordId: "activity:9005",
      payload: {
        activityKind: "branch_deletion",
        ref: "refs/heads/codex/system-reset",
        beforeSha: "cccccccccccccccccccccccccccccccccccccccc",
        deleted: true,
      },
    });
    expect(imported.batch.events.filter(({ sourceRecordId }) => sourceRecordId === "activity:9003")).toHaveLength(1);
    expect(imported.batch.events.filter(({ sourceRecordId }) => sourceRecordId === "activity:9005")).toHaveLength(1);
    const legacyEvent = normalizePush(
      {
        id: 9001,
        type: "PushEvent",
        actor: { id: 42 },
        repo: { id: 1001 },
        payload: {
          ref: "refs/heads/codex/system-reset",
          before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        created_at: "2026-08-31T08:01:00Z",
      },
      { id: "42", login: "JimmyTheGhost" },
      now().toISOString(),
    );
    expect(legacyEvent?.sourceRecordId).toBe("9001");
    expect(legacyEvent?.payload.activityKind).toBe("push");
    expect(legacyEvent?.idempotencyKey).not.toBe(imported.batch.events[0]?.idempotencyKey);
    expect(imported.batch.coverage.endpoint).toBe("GET /repos/{owner}/{repo}/activity");
    expect(imported.batch.coverage.reason).toContain("branch-creation");
    expect(imported.batch.coverage.reason).toContain("branch-deletion");
    expect(imported.batch.events.every(isPrivacySafeGitHubEvent)).toBe(true);
  });

  it("counts 19 distinct activity pushes on a non-default branch", async () => {
    const activities = Array.from({ length: 19 }, (_, index) => ({
      id: 10_000 + index,
      node_id: `activity-${index}`,
      activity_type: "push",
      actor: "JimmyTheGhost",
      ref: "refs/heads/codex/system-reset",
      before: index.toString(16).padStart(40, "0"),
      after: (index + 1).toString(16).padStart(40, "0"),
      timestamp: `2026-08-31T${String(index).padStart(2, "0")}:00:00Z`,
    }));
    const repository = {
      id: "1001",
      repositoryId: githubRepositoryId("1001"),
      name: "agent-dashboard",
      fullName: "JimmyTheGhost/agent-dashboard",
      owner: "JimmyTheGhost",
      defaultBranch: "main",
      visibility: "private" as const,
      isPrivate: true,
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-31T01:00:00.000Z",
    };
    const runner = new FixtureRunner(() => success([activities]));
    const imported = await new GitHubCollector({ runner, now }).importRepositoryPushActivity(
      { id: "42", login: "JimmyTheGhost" },
      [repository],
    );

    expect(imported.batch.events).toHaveLength(19);
    expect(new Set(imported.batch.events.map(({ idempotencyKey }) => idempotencyKey))).toHaveLength(19);
    expect(
      imported.batch.events.every(
        (event) =>
          event.eventType === "github.push.observed" &&
          event.payload.ref === "refs/heads/codex/system-reset",
      ),
    ).toBe(true);
  });

  it("keeps successful branches and repositories when sibling requests fail", async () => {
    const repositories = repositoriesFixture.flat().map((record) => ({
      id: String(record.id),
      repositoryId: githubRepositoryId(String(record.id)),
      name: record.name,
      fullName: record.full_name,
      owner: record.owner.login,
      defaultBranch: record.default_branch,
      visibility: record.visibility as "private" | "public",
      isPrivate: record.private,
      createdAt: new Date(record.created_at).toISOString(),
      updatedAt: new Date(record.updated_at).toISOString(),
    }));
    const runner = new FixtureRunner((_command, args) => {
      const requested = endpoint(args);
      if (requested.includes("agent-dashboard/branches")) return success(branchesFixture);
      if (requested.includes("sha=main")) return success([commitsFixture[0]]);
      if (requested.includes("sha=codex%2Fsystem-reset")) return { stdout: "", stderr: "sensitive branch error", exitCode: 1 };
      if (requested.includes("public-tool/branches")) return { stdout: "", stderr: "sensitive repo error", exitCode: 1 };
      if (requested.includes("agent-dashboard/activity")) return success(activityFixture);
      if (requested.includes("public-tool/activity")) return { stdout: "", stderr: "sensitive activity error", exitCode: 1 };
      throw new Error(`unexpected endpoint: ${requested}`);
    });
    const collector = new GitHubCollector({ runner, now });
    const commits = await collector.importAllBranchCommits({ id: "42", login: "JimmyTheGhost" }, repositories);
    const pushes = await collector.importRepositoryPushActivity({ id: "42", login: "JimmyTheGhost" }, repositories);

    expect(commits.batch.events).toHaveLength(1);
    expect(commits.failures).toHaveLength(2);
    expect(pushes.batch.events).toHaveLength(4);
    expect(pushes.failures).toHaveLength(1);
    expect(JSON.stringify({ commits, pushes })).not.toContain("sensitive");
  });

  it("returns privacy-safe partial failures while continuing other streams", async () => {
    const runner = new FixtureRunner((_command, args) => {
      const requested = endpoint(args);
      if (requested === "user") return success(accountFixture);
      if (requested.startsWith("user/repos")) return success([repositoriesFixture[0]]);
      if (requested.includes("/branches?")) {
        return { stdout: "", stderr: "server details that should not be returned", exitCode: 1 };
      }
      if (requested.includes("/activity?")) {
        return { stdout: "", stderr: "network failure", exitCode: 1 };
      }
      throw new Error("unexpected endpoint");
    });
    const result = await new GitHubCollector({ runner, now }).collect();

    expect(result.failures).toEqual([
      {
        stream: "commits",
        code: "api_failed",
        message: "GitHub API request failed",
        repositoryId: "github:1001",
      },
      {
        stream: "pushes",
        code: "api_failed",
        message: "GitHub API request failed",
        repositoryId: "github:1001",
      },
    ]);
    expect(result.coverage.at(-1)).toMatchObject({ stream: "pushes", completeness: "partial" });
    expect(JSON.stringify(result)).not.toContain("server details");
  });

  it("classifies missing gh and authentication failures without exposing stderr", async () => {
    const missing = new GitHubCollector({
      runner: new FixtureRunner(() => Promise.reject(new Error("ENOENT /secret/path"))),
      now,
    });
    await expect(missing.getAuthenticatedAccount()).rejects.toMatchObject({
      code: "gh_unavailable",
      message: "GitHub CLI is unavailable",
    });

    const unauthenticated = new GitHubCollector({
      runner: new FixtureRunner(() => ({
        stdout: "",
        stderr: "not logged into github.com with credential SECRET",
        exitCode: 1,
      })),
      now,
    });
    await expect(unauthenticated.getAuthenticatedAccount()).rejects.toBeInstanceOf(GitHubCollectorError);
    await expect(unauthenticated.getAuthenticatedAccount()).rejects.toMatchObject({
      code: "authentication_failed",
      message: "GitHub CLI authentication is required",
    });
  });
});
