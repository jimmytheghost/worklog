import type { AnyNormalizedEvent, Completeness } from "@agent-dashboard/domain";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(command: string, args: readonly string[]): Promise<CommandResult>;
}

export interface GitHubAccount {
  id: string;
  login: string;
}

export interface GitHubRepository {
  id: string;
  repositoryId: string;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  visibility: "public" | "private" | "internal" | "unknown";
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CollectionStream = "repositories" | "commits" | "pushes";

export interface CollectionCoverage {
  stream: CollectionStream;
  completeness: Completeness;
  source: "github_rest_v3";
  endpoint: string;
  observedAt: string;
  coverageStart?: string;
  coverageEnd?: string;
  reason: string;
}

export interface CollectionBatch {
  events: AnyNormalizedEvent[];
  coverage: CollectionCoverage;
}

export type GitHubCollectorErrorCode =
  | "gh_unavailable"
  | "authentication_failed"
  | "api_failed"
  | "malformed_response";

export interface CollectionFailure {
  stream: CollectionStream;
  code: GitHubCollectorErrorCode;
  message: string;
  repositoryId?: string;
}

export interface GitHubCollectionResult {
  account: GitHubAccount;
  repositories: GitHubRepository[];
  events: AnyNormalizedEvent[];
  coverage: CollectionCoverage[];
  failures: CollectionFailure[];
}

export interface GitHubCollectorOptions {
  runner?: CommandRunner;
  now?: () => Date;
  ghCommand?: string;
}
