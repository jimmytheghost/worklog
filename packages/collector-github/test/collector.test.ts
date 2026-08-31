import { describe, expect, it } from "vitest";

import accountFixture from "./fixtures/account.json";
import commitsFixture from "./fixtures/commits-pages.json";
import eventsFixture from "./fixtures/events-pages.json";
import repositoriesFixture from "./fixtures/repositories-pages.json";
import {
  GitHubCollector,
  GitHubCollectorError,
  githubRepositoryId,
  isPrivacySafeGitHubEvent,
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
  it("discovers paginated public and private owned repositories with stable IDs", async () => {
    const runner = new FixtureRunner((_command, args) => {
      if (endpoint(args) === "user") return success(accountFixture);
      return success(repositoriesFixture);
    });
    const collector = new GitHubCollector({ runner, now });
    const account = await collector.getAuthenticatedAccount();
    const discovered = await collector.discoverOwnedRepositories(account);

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
  });

  it("imports all commit pages, drops duplicate SHAs, and retains no sensitive commit data", async () => {
    const runner = new FixtureRunner((_command, args) => {
      const requested = endpoint(args);
      if (requested === "user") return success(accountFixture);
      if (requested.startsWith("user/repos")) return success([repositoriesFixture[0]]);
      if (requested.includes("/commits?")) return success(commitsFixture);
      return success([[]]);
    });
    const collector = new GitHubCollector({ runner, now });
    const account = await collector.getAuthenticatedAccount();
    const discovered = await collector.discoverOwnedRepositories(account);
    const imported = await collector.importDefaultBranchCommits(account, discovered.repositories);

    expect(imported.batch.events).toHaveLength(2);
    expect(imported.batch.coverage).toMatchObject({ completeness: "partial", stream: "commits" });
    expect(imported.failures).toEqual([]);
    expect(imported.batch.events.every(isPrivacySafeGitHubEvent)).toBe(true);
    expect(JSON.stringify(imported.batch.events)).not.toContain("must never enter");
    expect(JSON.stringify(imported.batch.events)).not.toContain("secret.txt");
    expect(imported.batch.events[0]?.idempotencyKey).toContain("git.commit");
    expect(imported.batch.events[0]).toMatchObject({
      occurredAt: "2026-08-30T02:01:00.000Z",
      payload: {
        authorOccurredAt: "2026-08-30T02:00:00.000Z",
        committerOccurredAt: "2026-08-30T02:01:00.000Z",
      },
    });
  });

  it("deduplicates push observations and joins renamed repositories by immutable ID", async () => {
    const runner = new FixtureRunner((_command, args) => {
      if (endpoint(args).startsWith("users/")) return success(eventsFixture);
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
    const batch = await collector.importRecentPushObservations(
      { id: "42", login: "JimmyTheGhost" },
      repositories,
    );

    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]).toMatchObject({
      repositoryId: "github:1001",
      sourceRecordId: "evt-1",
      completeness: "partial",
      payload: { membershipComplete: false, ref: "refs/heads/main" },
    });
    expect(batch.coverage.reason).toContain("300 events and 30 days");
  });

  it("returns privacy-safe partial failures while continuing other streams", async () => {
    const runner = new FixtureRunner((_command, args) => {
      const requested = endpoint(args);
      if (requested === "user") return success(accountFixture);
      if (requested.startsWith("user/repos")) return success([repositoriesFixture[0]]);
      if (requested.includes("/commits?")) {
        return { stdout: "", stderr: "server details that should not be returned", exitCode: 1 };
      }
      if (requested.startsWith("users/")) {
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
      { stream: "pushes", code: "api_failed", message: "GitHub API request failed" },
    ]);
    expect(result.coverage.at(-1)).toMatchObject({ stream: "pushes", completeness: "unavailable" });
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
