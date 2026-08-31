import {
  commitIdempotencyKey,
  githubPushIdempotencyKey,
  repositoryIdempotencyKey,
  type AnyNormalizedEvent,
  type NormalizedEvent,
} from "@agent-dashboard/domain";

import { GitHubCollectorError } from "./errors.js";
import type { GitHubAccount, GitHubRepository } from "./types.js";

export const ADAPTER_NAME = "github-gh-api";
export const ADAPTER_VERSION = "0.0.0";
export const SOURCE_FORMAT_VERSION = "rest.v3-2022-11-28";
const ZERO_SHA = /^0{40,64}$/;
const VALID_SHA = /^[0-9a-fA-F]{40,64}$/;

interface GitHubOwnerRecord {
  login?: unknown;
}

export interface GitHubRepositoryRecord {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  owner?: GitHubOwnerRecord;
  default_branch?: unknown;
  private?: unknown;
  visibility?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface GitHubCommitRecord {
  sha?: unknown;
  commit?: {
    author?: { date?: unknown } | null;
    committer?: { date?: unknown } | null;
  };
  parents?: Array<{ sha?: unknown }>;
}

export interface GitHubPushEventRecord {
  id?: unknown;
  type?: unknown;
  actor?: { id?: unknown; login?: unknown };
  repo?: { id?: unknown; name?: unknown };
  payload?: {
    before?: unknown;
    head?: unknown;
    after?: unknown;
    ref?: unknown;
    push_id?: unknown;
    size?: unknown;
    commits?: Array<{ sha?: unknown }>;
  };
  public?: unknown;
  created_at?: unknown;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GitHubCollectorError("malformed_response", `GitHub response is missing ${field}`);
  }
  return value;
}

function requiredId(value: unknown, field: string): string {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).length === 0) {
    throw new GitHubCollectorError("malformed_response", `GitHub response is missing ${field}`);
  }
  return String(value);
}

function instant(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (Number.isNaN(Date.parse(text))) {
    throw new GitHubCollectorError("malformed_response", `GitHub response has invalid ${field}`);
  }
  return new Date(text).toISOString();
}

function normalizedSha(value: unknown): string | undefined {
  if (typeof value !== "string" || !VALID_SHA.test(value) || ZERO_SHA.test(value)) return undefined;
  return value.toLowerCase();
}

export function githubRepositoryId(immutableId: string): string {
  return `github:${immutableId}`;
}

export function parseRepository(record: GitHubRepositoryRecord): GitHubRepository {
  const id = requiredId(record.id, "repository.id");
  const visibility = ["public", "private", "internal"].includes(String(record.visibility))
    ? (record.visibility as "public" | "private" | "internal")
    : typeof record.private === "boolean"
      ? record.private
        ? "private"
        : "public"
      : "unknown";

  return {
    id,
    repositoryId: githubRepositoryId(id),
    name: requiredString(record.name, "repository.name"),
    fullName: requiredString(record.full_name, "repository.full_name"),
    owner: requiredString(record.owner?.login, "repository.owner.login"),
    defaultBranch: requiredString(record.default_branch, "repository.default_branch"),
    visibility,
    isPrivate: record.private === true,
    createdAt: instant(record.created_at, "repository.created_at"),
    updatedAt: instant(record.updated_at, "repository.updated_at"),
  };
}

export function normalizeRepository(
  record: GitHubRepositoryRecord,
  account: GitHubAccount,
  observedAt: string,
): { repository: GitHubRepository; event: NormalizedEvent<"repository.discovered"> } {
  const repository = parseRepository(record);
  const idempotencyKey = repositoryIdempotencyKey("github", repository.id);
  return {
    repository,
    event: {
      eventId: idempotencyKey,
      eventType: "repository.discovered",
      schemaVersion: 1,
      entityType: "repository",
      entityId: repository.repositoryId,
      repositoryId: repository.repositoryId,
      occurredAt: repository.createdAt,
      occurredAtSource: "source",
      observedAt,
      sourceSystem: "github",
      sourceAccountId: account.id,
      sourceRecordId: repository.id,
      adapterName: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
      sourceFormatVersion: SOURCE_FORMAT_VERSION,
      idempotencyKey,
      attribution: "unknown",
      confidence: "unknown",
      completeness: "complete",
      payload: {
        repositoryKey: repository.repositoryId,
        name: repository.name,
        owner: repository.owner,
        visibility: repository.visibility,
      },
    },
  };
}

export function normalizeCommit(
  record: GitHubCommitRecord,
  repository: GitHubRepository,
  account: GitHubAccount,
  observedAt: string,
): NormalizedEvent<"git.commit.discovered"> {
  const sha = normalizedSha(record.sha);
  if (sha === undefined) {
    throw new GitHubCollectorError("malformed_response", "GitHub response has invalid commit.sha");
  }
  const committerOccurredAt = instant(record.commit?.committer?.date, "commit.committer.date");
  const authorOccurredAt =
    record.commit?.author?.date === null || record.commit?.author?.date === undefined
      ? undefined
      : instant(record.commit.author.date, "commit.author.date");
  const parentShas = (record.parents ?? []).map((parent) => {
    const parentSha = normalizedSha(parent.sha);
    if (parentSha === undefined) {
      throw new GitHubCollectorError("malformed_response", "GitHub response has invalid parent.sha");
    }
    return parentSha;
  });
  const idempotencyKey = commitIdempotencyKey(repository.repositoryId, sha);

  return {
    eventId: idempotencyKey,
    eventType: "git.commit.discovered",
    schemaVersion: 1,
    entityType: "commit",
    entityId: `${repository.repositoryId}:commit:${sha}`,
    repositoryId: repository.repositoryId,
    occurredAt: committerOccurredAt,
    occurredAtSource: "source",
    observedAt,
    sourceSystem: "github",
    sourceAccountId: account.id,
    sourceRecordId: sha,
    adapterName: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    sourceFormatVersion: SOURCE_FORMAT_VERSION,
    idempotencyKey,
    attribution: "unknown",
    confidence: "unknown",
    completeness: "partial",
    payload: {
      sha,
      ...(authorOccurredAt === undefined ? {} : { authorOccurredAt }),
      committerOccurredAt,
      parentShas,
    },
  };
}

export function normalizePush(
  record: GitHubPushEventRecord,
  account: GitHubAccount,
  observedAt: string,
): NormalizedEvent<"github.push.observed"> | undefined {
  if (record.type !== "PushEvent") return undefined;
  const actorId = requiredId(record.actor?.id, "event.actor.id");
  if (actorId !== account.id) return undefined;
  const eventId = requiredId(record.id, "event.id");
  const immutableRepositoryId = requiredId(record.repo?.id, "event.repo.id");
  const repositoryId = githubRepositoryId(immutableRepositoryId);
  const beforeSha = normalizedSha(record.payload?.before);
  const afterSha = normalizedSha(record.payload?.head ?? record.payload?.after);
  const commitShas = (record.payload?.commits ?? [])
    .map((commit) => normalizedSha(commit.sha))
    .filter((sha): sha is string => sha !== undefined);
  const occurredAt = instant(record.created_at, "event.created_at");
  const idempotencyKey = githubPushIdempotencyKey(account.id, eventId);
  const deleted =
    typeof record.payload?.head === "string" && ZERO_SHA.test(record.payload.head) ? true : undefined;

  return {
    eventId: idempotencyKey,
    eventType: "github.push.observed",
    schemaVersion: 1,
    entityType: "push",
    entityId: `${account.id}:github-event:${eventId}`,
    repositoryId,
    occurredAt,
    occurredAtSource: "source",
    observedAt,
    sourceSystem: "github",
    sourceAccountId: account.id,
    sourceRecordId: eventId,
    adapterName: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    sourceFormatVersion: SOURCE_FORMAT_VERSION,
    idempotencyKey,
    attribution: "unknown",
    confidence: "unknown",
    completeness: "partial",
    payload: {
      ref: requiredString(record.payload?.ref, "event.payload.ref"),
      ...(beforeSha === undefined ? {} : { beforeSha }),
      ...(afterSha === undefined ? {} : { afterSha }),
      commitShas,
      membershipComplete: false,
      ...(deleted === undefined ? {} : { deleted }),
    },
  };
}

export function isPrivacySafeGitHubEvent(event: AnyNormalizedEvent): boolean {
  const serialized = JSON.stringify(event);
  return !/commit\.message|\"message\"|patch|diff|contents|token|credential/i.test(serialized);
}
