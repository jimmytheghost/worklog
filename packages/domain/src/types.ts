export const ATTRIBUTIONS = ["codex", "human", "unknown"] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];

export const CONFIDENCE_LEVELS = ["confirmed", "correlated", "unknown"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const COMPLETENESS_LEVELS = [
  "complete",
  "partial",
  "prospective",
  "unavailable",
  "unknown",
] as const;
export type Completeness = (typeof COMPLETENESS_LEVELS)[number];

export const FRESHNESS_LEVELS = ["fresh", "stale", "never"] as const;
export type Freshness = (typeof FRESHNESS_LEVELS)[number];

export const SOURCE_SYSTEMS = [
  "github",
  "git_local",
  "codex_local",
  "openai_usage",
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const OCCURRED_AT_SOURCES = ["source", "derived", "observed"] as const;
export type OccurredAtSource = (typeof OCCURRED_AT_SOURCES)[number];

export const METRIC_UNITS = ["count", "tokens", "milliseconds", "currency"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const EVENT_TYPES = [
  "git.commit.discovered",
  "github.push.observed",
  "git.ref.snapshot_observed",
  "repository.discovered",
  "repository.metadata_changed",
  "codex.task.started",
  "codex.session.started",
  "codex.subagent.spawned",
  "codex.session.completed",
  "codex.usage.recorded",
  "openai.api_usage.recorded",
  "openai.api_cost.recorded",
  "association.recorded",
  "association.corrected",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventPayloads {
  "git.commit.discovered": {
    sha: string;
    authorOccurredAt?: string | undefined;
    committerOccurredAt: string;
    parentShas: string[];
  };
  "github.push.observed": {
    ref: string;
    beforeSha?: string | undefined;
    afterSha?: string | undefined;
    commitShas: string[];
    membershipComplete: boolean;
    forced?: boolean | undefined;
    deleted?: boolean | undefined;
  };
  "git.ref.snapshot_observed": {
    ref: string;
    sha?: string | undefined;
    deleted?: boolean | undefined;
  };
  "repository.discovered": {
    repositoryKey: string;
    name: string;
    owner?: string | undefined;
    visibility?: "public" | "private" | "internal" | "unknown" | undefined;
  };
  "repository.metadata_changed": {
    changedFields: string[];
  };
  "codex.task.started": {
    sourceTaskId: string;
    workspacePathHash?: string | undefined;
  };
  "codex.session.started": {
    sourceSessionId: string;
    model?: string | undefined;
  };
  "codex.subagent.spawned": {
    parentSessionId: string;
    childSessionId: string;
  };
  "codex.session.completed": {
    outcome: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
    durationMilliseconds?: number | undefined;
  };
  "codex.usage.recorded": {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    cachedTokens?: number | undefined;
    reasoningTokens?: number | undefined;
    bucketStart?: string | undefined;
    bucketEnd?: string | undefined;
  };
  "openai.api_usage.recorded": {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    cachedTokens?: number | undefined;
    bucketStart: string;
    bucketEnd: string;
    dimensions: Record<string, string>;
  };
  "openai.api_cost.recorded": {
    amount: number;
    currency: string;
    bucketStart: string;
    bucketEnd: string;
    dimensions: Record<string, string>;
  };
  "association.recorded": AssociationPayload;
  "association.corrected": AssociationPayload & { supersedesAssociationId: string };
}

export interface AssociationPayload {
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
  method: string;
  reason?: string | undefined;
}

export interface NormalizedEventBase<T extends EventType = EventType> {
  eventId: string;
  eventType: T;
  schemaVersion: number;
  entityType: string;
  entityId: string;
  repositoryId?: string | undefined;
  taskId?: string | undefined;
  sessionId?: string | undefined;
  occurredAt: string;
  occurredAtSource: OccurredAtSource;
  observedAt: string;
  sourceSystem: SourceSystem;
  sourceAccountId: string;
  sourceRecordId: string;
  adapterName: string;
  adapterVersion: string;
  sourceFormatVersion?: string | undefined;
  idempotencyKey: string;
  attribution: Attribution;
  confidence: Confidence;
  completeness: Completeness;
  rawRecordHash?: string | undefined;
}

export type NormalizedEvent<T extends EventType = EventType> = NormalizedEventBase<T> & {
  payload: EventPayloads[T];
};

export type AnyNormalizedEvent = {
  [T in EventType]: NormalizedEvent<T>;
}[EventType];

export interface MetricInterval {
  start: string;
  end: string;
  timezone: string;
}

export interface MetricResult {
  metric: string;
  value: number | null;
  unit: MetricUnit;
  interval: MetricInterval;
  dimensions: Record<string, string>;
  sourceSystems: SourceSystem[];
  completeness: Completeness;
  coverageStart?: string | undefined;
  coverageEnd?: string | undefined;
  coverageReason?: string | undefined;
  lastSucceededAt?: string | undefined;
  freshness: Freshness;
}

export interface DailyCount {
  localDate: string;
  count: number;
}
