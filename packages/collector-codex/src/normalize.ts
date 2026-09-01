import {
  codexLifecycleIdempotencyKey,
  codexUsageIdempotencyKey,
  type AnyNormalizedEvent,
  type NormalizedEvent,
} from "@agent-dashboard/domain";

import type {
  CodexSessionMetadata,
  CodexSessionStatus,
  CumulativeTokenObservation,
  ResolvedCodexEdge,
} from "./types.js";

export const ADAPTER_NAME = "codex-local-experimental";
export const ADAPTER_VERSION = "0.0.0";

interface NormalizationContext {
  sourceInstanceId: string;
  sourceFormatVersion: string;
  observedAt: string;
}

function lifecycleBase(
  context: NormalizationContext,
  eventKind: string,
  sessionId: string,
  revision: string,
) {
  const idempotencyKey = codexLifecycleIdempotencyKey(
    eventKind,
    context.sourceInstanceId,
    sessionId,
    revision,
  );
  return {
    eventId: idempotencyKey,
    schemaVersion: 1,
    taskId: sessionId,
    sessionId,
    sourceSystem: "codex_local" as const,
    sourceAccountId: context.sourceInstanceId,
    adapterName: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    sourceFormatVersion: context.sourceFormatVersion,
    idempotencyKey,
    attribution: "codex" as const,
    confidence: "confirmed" as const,
    completeness: "partial" as const,
  };
}

export function normalizeTaskStarted(
  session: CodexSessionMetadata,
  context: NormalizationContext,
): NormalizedEvent<"codex.task.started"> {
  return {
    ...lifecycleBase(context, "task.started", session.sourceSessionId, session.startedAt),
    eventType: "codex.task.started",
    entityType: "codex_task",
    entityId: `codex-task:${session.sourceSessionId}`,
    occurredAt: session.startedAt,
    occurredAtSource: "source",
    observedAt: context.observedAt,
    sourceRecordId: session.sourceSessionId,
    payload: {
      sourceTaskId: session.sourceSessionId,
      workspaceIdentityHash: session.workspaceIdentityHash,
      ...(session.repositorySlug === undefined ? {} : { repositorySlug: session.repositorySlug }),
    },
  };
}

export function normalizeSessionStarted(
  session: CodexSessionMetadata,
  context: NormalizationContext,
): NormalizedEvent<"codex.session.started"> {
  return {
    ...lifecycleBase(context, "session.started", session.sourceSessionId, session.startedAt),
    eventType: "codex.session.started",
    entityType: "codex_session",
    entityId: `codex-session:${session.sourceSessionId}`,
    occurredAt: session.startedAt,
    occurredAtSource: "source",
    observedAt: context.observedAt,
    sourceRecordId: session.sourceSessionId,
    payload: {
      sourceSessionId: session.sourceSessionId,
      ...(session.model === undefined ? {} : { model: session.model }),
      reasoningEffort: session.reasoningEffort,
      agentRole: session.agentRole,
      ...(session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId }),
    },
  };
}

export function normalizeSpawned(
  edge: ResolvedCodexEdge,
  childStartedAt: string,
  context: NormalizationContext,
): NormalizedEvent<"codex.subagent.spawned"> {
  return {
    ...lifecycleBase(context, "subagent.spawned", edge.childSessionId, edge.parentSessionId),
    eventType: "codex.subagent.spawned",
    entityType: "codex_subagent_edge",
    entityId: `codex-edge:${edge.parentSessionId}:${edge.childSessionId}`,
    occurredAt: childStartedAt,
    occurredAtSource: "derived",
    observedAt: context.observedAt,
    sourceRecordId: `${edge.parentSessionId}:${edge.childSessionId}`,
    payload: {
      parentSessionId: edge.parentSessionId,
      childSessionId: edge.childSessionId,
    },
  };
}

function completionOutcome(status: CodexSessionStatus) {
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
    ? status
    : "unknown";
}

export function normalizeSessionCompleted(
  session: CodexSessionMetadata,
  terminalAt: string,
  durationMilliseconds: number | undefined,
  context: NormalizationContext,
): NormalizedEvent<"codex.session.completed"> {
  return {
    ...lifecycleBase(context, "session.completed", session.sourceSessionId, terminalAt),
    eventType: "codex.session.completed",
    entityType: "codex_session",
    entityId: `codex-session:${session.sourceSessionId}`,
    occurredAt: terminalAt,
    occurredAtSource: "source",
    observedAt: context.observedAt,
    sourceRecordId: `${session.sourceSessionId}:terminal:${terminalAt}`,
    payload: {
      outcome: completionOutcome(session.status),
      ...(durationMilliseconds === undefined ? {} : { durationMilliseconds }),
    },
  };
}

export function normalizeSessionStateObserved(
  session: CodexSessionMetadata,
  durationMilliseconds: number | undefined,
  context: NormalizationContext,
): NormalizedEvent<"codex.session.state_observed"> {
  const revision = `${session.updatedAt}:${session.status}`;
  return {
    ...lifecycleBase(context, "session.state_observed", session.sourceSessionId, revision),
    eventType: "codex.session.state_observed",
    entityType: "codex_session",
    entityId: `codex-session:${session.sourceSessionId}`,
    occurredAt: session.updatedAt,
    occurredAtSource: "source",
    observedAt: context.observedAt,
    sourceRecordId: `${session.sourceSessionId}:state:${revision}`,
    payload: {
      sourceSessionId: session.sourceSessionId,
      status: session.status,
      ...(durationMilliseconds === undefined ? {} : { durationMilliseconds }),
    },
  };
}

export function normalizeUsage(
  session: CodexSessionMetadata,
  tokens: CumulativeTokenObservation,
  context: NormalizationContext,
): NormalizedEvent<"codex.usage.recorded"> {
  const idempotencyKey = codexUsageIdempotencyKey(
    context.sourceInstanceId,
    session.sourceSessionId,
    `bucket-end:${tokens.observedAt}`,
  );
  return {
    eventId: idempotencyKey,
    eventType: "codex.usage.recorded",
    schemaVersion: 1,
    entityType: "codex_usage_snapshot",
    entityId: `codex-usage:${session.sourceSessionId}:${tokens.observedAt}`,
    taskId: session.sourceSessionId,
    sessionId: session.sourceSessionId,
    occurredAt: tokens.observedAt,
    occurredAtSource: "source",
    observedAt: context.observedAt,
    sourceSystem: "codex_local",
    sourceAccountId: context.sourceInstanceId,
    sourceRecordId: `${session.sourceSessionId}:token:${tokens.observedAt}`,
    adapterName: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    sourceFormatVersion: context.sourceFormatVersion,
    idempotencyKey,
    attribution: "codex",
    confidence: "confirmed",
    completeness: "partial",
    payload:
      tokens.countersAvailable
        ? {
            counterKind: "cumulative",
            sourceSessionId: session.sourceSessionId,
            countersAvailable: true,
            inputTokens: tokens.inputTokens,
            cachedTokens: tokens.cachedTokens,
            cacheWriteTokens: tokens.cacheWriteTokens,
            outputTokens: tokens.outputTokens,
            reasoningTokens: tokens.reasoningTokens,
            totalTokens: tokens.totalTokens,
            bucketStart: session.startedAt,
            bucketEnd: tokens.observedAt,
          }
        : {
            counterKind: "cumulative",
            sourceSessionId: session.sourceSessionId,
            countersAvailable: false,
            bucketStart: session.startedAt,
            bucketEnd: tokens.observedAt,
          },
  };
}

export function isPrivacySafeCodexEvent(event: AnyNormalizedEvent): boolean {
  return !/(prompt|response|command|arguments|tool.?output|diff|credential|source.?content|rollout.?path|workspace.?path)/i.test(
    JSON.stringify(event),
  );
}
