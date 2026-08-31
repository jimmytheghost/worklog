import type {
  AnyNormalizedEvent,
  NormalizedEvent,
} from "@agent-dashboard/domain";

import type {
  CodexSessionReadModel,
  CodexTaskReadModel,
} from "./types.js";

type TaskStartedEvent = NormalizedEvent<"codex.task.started">;
type SessionStartedEvent = NormalizedEvent<"codex.session.started">;
type SessionCompletedEvent = NormalizedEvent<"codex.session.completed">;
type SessionStateEvent = NormalizedEvent<"codex.session.state_observed">;
type SpawnedEvent = NormalizedEvent<"codex.subagent.spawned">;
type UsageEvent = NormalizedEvent<"codex.usage.recorded">;
type LifecycleStateEvent = SessionCompletedEvent | SessionStateEvent;

function shouldReplaceState(
  current: LifecycleStateEvent | undefined,
  candidate: LifecycleStateEvent,
): boolean {
  if (current === undefined) return true;
  if (candidate.occurredAt !== current.occurredAt) return candidate.occurredAt > current.occurredAt;
  if (candidate.eventType !== current.eventType) {
    return candidate.eventType === "codex.session.state_observed";
  }
  return candidate.eventId > current.eventId;
}

function countersAreUnavailable(event: UsageEvent): boolean {
  return "counterKind" in event.payload && event.payload.countersAvailable === false;
}

function shouldReplaceUsage(current: UsageEvent | undefined, candidate: UsageEvent): boolean {
  if (current === undefined) return true;
  if (!("counterKind" in current.payload) || !("counterKind" in candidate.payload)) return false;
  if (candidate.payload.bucketEnd !== current.payload.bucketEnd) {
    return Date.parse(candidate.payload.bucketEnd) > Date.parse(current.payload.bucketEnd);
  }
  if (candidate.observedAt !== current.observedAt) return candidate.observedAt > current.observedAt;
  if (countersAreUnavailable(candidate) !== countersAreUnavailable(current)) {
    return countersAreUnavailable(candidate);
  }
  return candidate.eventId > current.eventId;
}

function isLater(left: AnyNormalizedEvent, right: AnyNormalizedEvent): boolean {
  return (
    left.occurredAt > right.occurredAt ||
    (left.occurredAt === right.occurredAt && left.eventId > right.eventId)
  );
}

function replaceWithLater<T extends AnyNormalizedEvent>(
  map: Map<string, T>,
  key: string,
  candidate: T,
): void {
  const current = map.get(key);
  if (current === undefined || isLater(candidate, current)) map.set(key, candidate);
}

function stableTaskId(event: TaskStartedEvent): string {
  return event.taskId ?? event.entityId;
}

function stableSessionId(event: SessionStartedEvent): string {
  return event.sessionId ?? event.entityId;
}

function sortRecent<T extends { id: string; startedAt: string }>(left: T, right: T): number {
  return right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id);
}

function topologicalSessionOrder(sessions: CodexSessionReadModel[]): CodexSessionReadModel[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map<string, CodexSessionReadModel[]>();
  const roots: CodexSessionReadModel[] = [];

  for (const session of sessions) {
    if (session.parentSessionId === null || !byId.has(session.parentSessionId)) {
      roots.push(session);
      continue;
    }
    const siblings = children.get(session.parentSessionId) ?? [];
    siblings.push(session);
    children.set(session.parentSessionId, siblings);
  }

  roots.sort(sortRecent);
  for (const siblings of children.values()) siblings.sort(sortRecent);

  const result: CodexSessionReadModel[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (session: CodexSessionReadModel): void => {
    if (visited.has(session.id) || visiting.has(session.id)) return;
    visiting.add(session.id);
    result.push(session);
    visited.add(session.id);
    for (const child of children.get(session.id) ?? []) visit(child);
    visiting.delete(session.id);
  };

  for (const root of roots) visit(root);
  // Corrupt cyclic relationships do not hide sessions from the read model.
  for (const session of [...sessions].sort(sortRecent)) visit(session);
  return result;
}

export interface CodexReadModels {
  tasks: CodexTaskReadModel[];
  sessions: CodexSessionReadModel[];
}

/** Builds privacy-safe projections; raw event payloads never leave this module. */
export function buildCodexReadModels(events: readonly AnyNormalizedEvent[]): CodexReadModels {
  const taskStarts = new Map<string, TaskStartedEvent>();
  const sessionStarts = new Map<string, SessionStartedEvent>();

  for (const event of events) {
    if (event.eventType === "codex.task.started") {
      replaceWithLater(taskStarts, stableTaskId(event), event);
    } else if (event.eventType === "codex.session.started") {
      replaceWithLater(sessionStarts, stableSessionId(event), event);
    }
  }

  const sourceToStableSessionId = new Map<string, string>();
  for (const [id, event] of sessionStarts) {
    sourceToStableSessionId.set(event.payload.sourceSessionId, id);
    sourceToStableSessionId.set(id, id);
  }
  const resolveSessionId = (id: string): string => sourceToStableSessionId.get(id) ?? id;

  const parentByChild = new Map<string, { parentId: string; event: SpawnedEvent }>();
  const states = new Map<string, LifecycleStateEvent>();
  const cumulativeUsage = new Map<string, UsageEvent>();

  for (const event of events) {
    if (event.eventType === "codex.subagent.spawned") {
      const childId = resolveSessionId(event.payload.childSessionId);
      const parentId = resolveSessionId(event.payload.parentSessionId);
      const current = parentByChild.get(childId);
      if (current === undefined || isLater(event, current.event)) {
        parentByChild.set(childId, { parentId, event });
      }
    } else if (
      event.eventType === "codex.session.completed" ||
      event.eventType === "codex.session.state_observed"
    ) {
      const sessionId =
        event.eventType === "codex.session.state_observed"
          ? resolveSessionId(event.payload.sourceSessionId)
          : resolveSessionId(event.sessionId ?? event.entityId);
      const current = states.get(sessionId);
      if (shouldReplaceState(current, event)) states.set(sessionId, event);
    } else if (
      event.eventType === "codex.usage.recorded" &&
      "counterKind" in event.payload &&
      event.payload.counterKind === "cumulative"
    ) {
      const sessionId = resolveSessionId(event.payload.sourceSessionId);
      const current = cumulativeUsage.get(sessionId);
      if (shouldReplaceUsage(current, event)) cumulativeUsage.set(sessionId, event);
    }
  }

  const sessions = topologicalSessionOrder(
    [...sessionStarts.entries()].map(([id, started]) => {
      const explicitParent = started.payload.parentSessionId;
      const parentSessionId =
        parentByChild.get(id)?.parentId ??
        (explicitParent === undefined ? null : resolveSessionId(explicitParent));
      const candidateState = states.get(id);
      // A terminal event older than the selected start record is stale evidence.
      const state =
        candidateState !== undefined && candidateState.occurredAt >= started.occurredAt
          ? candidateState
          : undefined;
      const status =
        state?.eventType === "codex.session.state_observed"
          ? state.payload.status
          : (state?.payload.outcome ?? "active");
      const isTerminal = ["completed", "failed", "cancelled", "interrupted"].includes(status);
      const taskId = started.taskId ?? null;
      const task = taskId === null ? undefined : taskStarts.get(taskId);
      const usage = cumulativeUsage.get(id);
      const totalObservedTokens =
        usage !== undefined &&
        "counterKind" in usage.payload &&
        usage.payload.countersAvailable !== false
          ? usage.payload.totalTokens
          : null;

      return {
        id,
        taskId,
        parentSessionId,
        repositoryId: started.repositoryId ?? task?.repositoryId ?? null,
        label: task?.payload.label ?? null,
        model: started.payload.model ?? null,
        reasoningEffort: started.payload.reasoningEffort ?? null,
        role: started.payload.agentRole ?? (parentSessionId === null ? "unknown" : "subagent"),
        status,
        startedAt: started.occurredAt,
        completedAt: isTerminal ? (state?.occurredAt ?? null) : null,
        durationMilliseconds: isTerminal ? (state?.payload.durationMilliseconds ?? null) : null,
        totalObservedTokens,
      } satisfies CodexSessionReadModel;
    }),
  );

  const sessionsByTask = new Map<string, CodexSessionReadModel[]>();
  for (const session of sessions) {
    if (session.taskId === null) continue;
    const taskSessions = sessionsByTask.get(session.taskId) ?? [];
    taskSessions.push(session);
    sessionsByTask.set(session.taskId, taskSessions);
  }

  const tasks = [...taskStarts.entries()]
    .map(([id, started]) => {
      const taskSessions = sessionsByTask.get(id) ?? [];
      const primary =
        taskSessions.find((session) => session.role === "primary") ??
        taskSessions.find((session) => session.parentSessionId === null);
      const allTotalsKnown =
        taskSessions.length > 0 && taskSessions.every((session) => session.totalObservedTokens !== null);
      return {
        id,
        repositoryId: started.repositoryId ?? primary?.repositoryId ?? null,
        label: started.payload.label ?? null,
        primarySessionId: primary?.id ?? null,
        model: primary?.model ?? null,
        reasoningEffort: primary?.reasoningEffort ?? null,
        status: primary?.status ?? "unknown",
        startedAt: started.occurredAt,
        completedAt: primary?.completedAt ?? null,
        durationMilliseconds: primary?.durationMilliseconds ?? null,
        totalObservedTokens: allTotalsKnown
          ? taskSessions.reduce((sum, session) => sum + (session.totalObservedTokens ?? 0), 0)
          : null,
        sessionIds: taskSessions.map(({ id: sessionId }) => sessionId),
      } satisfies CodexTaskReadModel;
    })
    .sort(sortRecent);

  return { tasks, sessions };
}
