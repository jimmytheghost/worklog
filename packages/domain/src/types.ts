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
  "codex_account",
  "openai_usage",
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const OCCURRED_AT_SOURCES = ["source", "derived", "observed"] as const;
export type OccurredAtSource = (typeof OCCURRED_AT_SOURCES)[number];

export const METRIC_UNITS = ["count", "tokens", "milliseconds", "currency"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "unknown",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const AGENT_ROLES = ["primary", "subagent", "unknown"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const EVENT_TYPES = [
  "git.commit.discovered",
  "github.push.observed",
  "git.ref.snapshot_observed",
  "repository.discovered",
  "repository.metadata_changed",
  "codex.task.started",
  "codex.session.started",
  "codex.session.state_observed",
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
    /** Privacy-safe first line only; never the commit body. */
    subject?: string | undefined;
    /** Canonical browser URL supplied by the source, when available. */
    url?: string | undefined;
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
    activityKind?: "push" | "force_push" | "branch_creation" | "branch_deletion" | undefined;
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
    workspaceIdentityHash?: string | undefined;
    /** Privacy-safe GitHub owner/repository identity derived locally. */
    repositorySlug?: string | undefined;
    label?: string | undefined;
  };
  "codex.session.started": {
    sourceSessionId: string;
    model?: string | undefined;
    reasoningEffort?: ReasoningEffort | undefined;
    agentRole?: AgentRole | undefined;
    parentSessionId?: string | undefined;
  };
  "codex.session.state_observed": {
    sourceSessionId: string;
    status: CodexSessionState;
    durationMilliseconds?: number | undefined;
  };
  "codex.subagent.spawned": {
    parentSessionId: string;
    childSessionId: string;
  };
  "codex.session.completed": {
    outcome: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
    durationMilliseconds?: number | undefined;
  };
  "codex.usage.recorded":
    | LegacyCodexUsagePayload
    | CumulativeCodexUsagePayload
    | UnavailableCumulativeCodexUsagePayload;
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

export type CodexSessionState =
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "unknown";

export interface LegacyCodexUsagePayload {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  bucketStart?: string | undefined;
  bucketEnd?: string | undefined;
}

/**
 * A cumulative counter snapshot for one source session.
 *
 * Before summing usage across sessions, consumers MUST reduce these records to
 * the latest bucket per `sourceSessionId`. Summing every cumulative record would
 * repeatedly count the same tokens.
 */
export interface CumulativeCodexUsagePayload {
  counterKind: "cumulative";
  sourceSessionId: string;
  /** Omitted by v1 records; omission is backward-compatible with `true`. */
  countersAvailable?: true | undefined;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  bucketStart: string;
  bucketEnd: string;
}

/** Explicitly supersedes an older known cumulative snapshot with unknown counters. */
export interface UnavailableCumulativeCodexUsagePayload {
  counterKind: "cumulative";
  sourceSessionId: string;
  countersAvailable: false;
  bucketStart: string;
  bucketEnd: string;
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

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMinutes: number | null;
  resetsAt: string | null;
}

export interface CodexRateLimitBucket {
  limitId: string;
  limitName: string | null;
  planType: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
  individualLimit: {
    limit: string;
    used: string;
    remainingPercent: number;
    resetsAt: string;
  } | null;
  spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
}

export interface CodexAccountUsageSnapshot {
  sourceInstanceId: string;
  observedAt: string;
  planType: string | null;
  rateLimits: CodexRateLimitBucket[];
  bankedResetCount: number | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
  tokenUsage: {
    lifetimeTokens: number | null;
    peakDailyTokens: number | null;
    longestRunningTurnSeconds: number | null;
    currentStreakDays: number | null;
    longestStreakDays: number | null;
    daily: Array<{ date: string; tokens: number }> | null;
  };
}
