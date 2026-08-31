import type { AnyNormalizedEvent } from "./types.js";

function component(value: string | number): string {
  const normalized = String(value);
  return `${normalized.length}:${normalized}`;
}

function key(namespace: string, ...parts: ReadonlyArray<string | number>): string {
  return `${namespace}:${parts.map(component).join(":")}`;
}

export function commitIdempotencyKey(repositoryId: string, sha: string): string {
  return key("git.commit", repositoryId, sha.toLowerCase());
}

export function githubPushIdempotencyKey(sourceAccountId: string, githubEventId: string): string {
  return key("github.push", sourceAccountId, githubEventId);
}

export interface SyntheticPushIdentity {
  sourceAccountId: string;
  repositoryId: string;
  actorId: string;
  ref: string;
  beforeSha: string;
  afterSha: string;
  occurredAt: string;
}

/** Collision-free length-prefixed composite for sources lacking a native event ID. */
export function syntheticGithubPushIdempotencyKey(identity: SyntheticPushIdentity): string {
  return key(
    "github.push.synthetic.v1",
    identity.sourceAccountId,
    identity.repositoryId,
    identity.actorId,
    identity.ref,
    identity.beforeSha.toLowerCase(),
    identity.afterSha.toLowerCase(),
    identity.occurredAt,
  );
}

export function codexLifecycleIdempotencyKey(
  eventKind: string,
  sourceInstanceId: string,
  taskOrSessionId: string,
  sourceSequenceOrState: string | number,
): string {
  return key(`codex.${eventKind}`, sourceInstanceId, taskOrSessionId, sourceSequenceOrState);
}

export function codexUsageIdempotencyKey(
  sourceInstanceId: string,
  sessionId: string,
  bucketOrCounterRevision: string | number,
): string {
  return key("codex.usage", sourceInstanceId, sessionId, bucketOrCounterRevision);
}

export interface OpenAiBucketIdentity {
  sourceAccountId: string;
  endpoint: "usage" | "cost";
  bucketStart: string;
  bucketEnd: string;
  dimensions: Readonly<Record<string, string>>;
  sourceResultId?: string;
}

export function openAiBucketIdempotencyKey(identity: OpenAiBucketIdentity): string {
  const dimensions = Object.entries(identity.dimensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, value]) => [name, value]);

  return key(
    `openai.${identity.endpoint}`,
    identity.sourceAccountId,
    identity.bucketStart,
    identity.bucketEnd,
    ...dimensions,
    ...(identity.sourceResultId === undefined ? [] : [identity.sourceResultId]),
  );
}

export function repositoryIdempotencyKey(sourceSystem: string, immutableRepositoryId: string): string {
  return key("repository", sourceSystem, immutableRepositoryId);
}

/** Keeps the first observation of each semantic event and preserves input order. */
export function deduplicateEvents<T extends Pick<AnyNormalizedEvent, "idempotencyKey">>(
  events: readonly T[],
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const event of events) {
    if (seen.has(event.idempotencyKey)) continue;
    seen.add(event.idempotencyKey);
    unique.push(event);
  }

  return unique;
}
