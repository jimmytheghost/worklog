import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

import { deduplicateEvents, type AnyNormalizedEvent } from "@agent-dashboard/domain";

import { sanitizedReadError } from "./errors.js";
import {
  normalizeSessionCompleted,
  normalizeSessionStateObserved,
  normalizeSessionStarted,
  normalizeSpawned,
  normalizeTaskStarted,
  normalizeUsage,
} from "./normalize.js";
import { resolveCodexPaths, sourceInstanceId } from "./paths.js";
import { readRolloutMetadata } from "./rollout.js";
import { readCodexIndex } from "./sqlite.js";
import type {
  CodexCollectionResult,
  CodexCollectionWarning,
  CodexCollectorOptions,
  CodexSessionMetadata,
  CodexSessionStatus,
  CodexTurnRecord,
  ResolvedCodexEdge,
  RolloutMetadata,
  SourceSchemaDescription,
} from "./types.js";

const DEFAULT_STALE_EDGE_MS = 24 * 60 * 60 * 1_000;

function stableSchemaFingerprint(
  state: SourceSchemaDescription,
  history: SourceSchemaDescription | undefined,
): string {
  const canonical = JSON.stringify({ state, history: history ?? null });
  return createHash("sha256").update(canonical).digest("hex");
}

function sourceFormatVersion(fingerprint: string): string {
  return `codex-local-experimental-v1.${fingerprint.slice(0, 16)}`;
}

function normalizeStatus(status: string | undefined): CodexSessionStatus {
  switch (status?.toLowerCase()) {
    case "completed":
    case "complete":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "interrupted":
    case "aborted":
      return "interrupted";
    case "running":
    case "active":
    case "in_progress":
    case "inprogress":
    case "open":
      return "active";
    default:
      return "unknown";
  }
}

function chooseTerminal(
  turn: CodexTurnRecord | undefined,
  rollout: RolloutMetadata,
): { status: CodexSessionStatus; at?: string; duration?: number } {
  const turnStatus = normalizeStatus(turn?.status);
  if (turn !== undefined && turnStatus !== "unknown") {
    return {
      status: turnStatus,
      ...(turnStatus === "active" || turn.completedAt === undefined ? {} : { at: turn.completedAt }),
      ...(turnStatus === "active" || turn.durationMilliseconds === undefined
        ? {}
        : { duration: turn.durationMilliseconds }),
    };
  }
  if (rollout.terminalStatus !== undefined) {
    return {
      status: rollout.terminalStatus,
      ...(rollout.terminalAt === undefined ? {} : { at: rollout.terminalAt }),
      ...(rollout.terminalDurationMilliseconds === undefined
        ? {}
        : { duration: rollout.terminalDurationMilliseconds }),
    };
  }
  return { status: turnStatus };
}

function safeRolloutPath(root: string, indexedPath: string): string | undefined {
  const candidate = resolve(isAbsolute(indexedPath) ? indexedPath : resolve(root, indexedPath));
  const normalizedRoot = resolve(root);
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${sep}`)
    ? candidate
    : undefined;
}

function resolveEdges(
  rawEdges: ReadonlyArray<{ parentSessionId: string; childSessionId: string; reportedStatus: string }>,
  sessions: ReadonlyMap<string, CodexSessionMetadata>,
  now: Date,
  staleAfterMilliseconds: number,
): ResolvedCodexEdge[] {
  return rawEdges.map((edge) => {
    const child = sessions.get(edge.childSessionId);
    const reported = edge.reportedStatus.toLowerCase();
    const reportedOpen = reported === "open" || reported === "running" || reported === "active";
    if (!reportedOpen) {
      return { ...edge, resolvedStatus: reported === "closed" ? "closed" : "unknown" };
    }
    if (
      child !== undefined &&
      ["completed", "failed", "cancelled", "interrupted"].includes(child.status)
    ) {
      return {
        ...edge,
        resolvedStatus: "stale",
        reason: "Indexed edge is open but the child session is terminal",
      };
    }
    if (
      child !== undefined &&
      now.getTime() - Date.parse(child.updatedAt) > staleAfterMilliseconds
    ) {
      return {
        ...edge,
        resolvedStatus: "stale",
        reason: "Indexed edge is open but has exceeded the stale threshold",
      };
    }
    return { ...edge, resolvedStatus: "open" };
  });
}

export class CodexCollector {
  private readonly options: CodexCollectorOptions;

  constructor(options: CodexCollectorOptions = {}) {
    this.options = options;
  }

  async collect(): Promise<CodexCollectionResult> {
    try {
      return await this.collectInternal();
    } catch (error) {
      throw sanitizedReadError(error);
    }
  }

  private async collectInternal(): Promise<CodexCollectionResult> {
    const paths = resolveCodexPaths(this.options);
    const now = this.options.now?.() ?? new Date();
    const observedAt = now.toISOString();
    const sourceId = sourceInstanceId(paths.root);
    const index = readCodexIndex(paths.stateDatabase, paths.historyDatabase);
    const schemaFingerprint = stableSchemaFingerprint(index.stateSchema, index.historySchema);
    const formatVersion = sourceFormatVersion(schemaFingerprint);
    const latestTurns = new Map(index.latestTurns.map((turn) => [turn.threadId, turn]));
    const rolloutBySession = new Map<string, RolloutMetadata>();
    const warnings: CodexCollectionWarning[] = [];
    let rolloutFilesRead = 0;
    let malformedMetadataLines = 0;
    let sessionsMissingCounters = 0;

    for (const thread of index.threads) {
      const rolloutPath = safeRolloutPath(paths.root, thread.rolloutPath);
      if (rolloutPath === undefined) {
        warnings.push({
          code: "rollout_outside_root",
          sessionId: thread.id,
          message: "Indexed rollout path is outside the configured Codex data root",
        });
        rolloutBySession.set(thread.id, {
          malformedMetadataLines: 0,
          missingCumulativeCounters: false,
        });
        continue;
      }
      if (!existsSync(rolloutPath)) {
        warnings.push({
          code: "rollout_missing",
          sessionId: thread.id,
          message: "Indexed rollout metadata file is unavailable",
        });
        rolloutBySession.set(thread.id, {
          malformedMetadataLines: 0,
          missingCumulativeCounters: false,
        });
        continue;
      }
      try {
        const metadata = await readRolloutMetadata(rolloutPath);
        rolloutBySession.set(thread.id, metadata);
        rolloutFilesRead += 1;
        malformedMetadataLines += metadata.malformedMetadataLines;
        if (
          metadata.latestTokenObservation !== undefined &&
          !metadata.latestTokenObservation.countersAvailable
        ) {
          sessionsMissingCounters += 1;
          warnings.push({
            code: "missing_counters",
            sessionId: thread.id,
            message: "Cumulative token counters are incomplete and marked unavailable",
          });
        }
      } catch {
        warnings.push({
          code: "rollout_unreadable",
          sessionId: thread.id,
          message: "Rollout metadata could not be read",
        });
        rolloutBySession.set(thread.id, {
          malformedMetadataLines: 0,
          missingCumulativeCounters: false,
        });
      }
    }

    const rawEdgeMap = new Map(
      index.spawnEdges.map((edge) => [`${edge.parentSessionId}\u0000${edge.childSessionId}`, edge]),
    );
    for (const [childSessionId, rollout] of rolloutBySession) {
      if (rollout.parentSessionId === undefined) continue;
      const edgeKey = `${rollout.parentSessionId}\u0000${childSessionId}`;
      if (!rawEdgeMap.has(edgeKey)) {
        rawEdgeMap.set(edgeKey, {
          parentSessionId: rollout.parentSessionId,
          childSessionId,
          reportedStatus: "unknown",
        });
      }
    }
    const rawEdges = [...rawEdgeMap.values()];
    const indexedParent = new Map(rawEdges.map((edge) => [edge.childSessionId, edge.parentSessionId]));
    const sessions = index.threads.map((thread): CodexSessionMetadata => {
      const rollout = rolloutBySession.get(thread.id)!;
      const terminal = chooseTerminal(latestTurns.get(thread.id), rollout);
      const parentSessionId = indexedParent.get(thread.id) ?? rollout.parentSessionId;
      return {
        sourceSessionId: thread.id,
        startedAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        status: terminal.status,
        ...(thread.model === undefined ? {} : { model: thread.model }),
        reasoningEffort: thread.reasoningEffort,
        agentRole: parentSessionId === undefined ? "primary" : "subagent",
        ...(parentSessionId === undefined ? {} : { parentSessionId }),
        workspaceIdentityHash: thread.workspaceIdentityHash,
      };
    });
    const sessionMap = new Map(sessions.map((session) => [session.sourceSessionId, session]));
    const edges = resolveEdges(
      rawEdges,
      sessionMap,
      now,
      this.options.staleEdgeAfterMilliseconds ?? DEFAULT_STALE_EDGE_MS,
    );
    const context = { sourceInstanceId: sourceId, sourceFormatVersion: formatVersion, observedAt };
    const events: AnyNormalizedEvent[] = [];

    for (const session of sessions) {
      events.push(normalizeTaskStarted(session, context), normalizeSessionStarted(session, context));
      const rollout = rolloutBySession.get(session.sourceSessionId)!;
      const terminal = chooseTerminal(latestTurns.get(session.sourceSessionId), rollout);
      events.push(normalizeSessionStateObserved(session, terminal.duration, context));
      if (terminal.at !== undefined && session.status !== "active" && session.status !== "unknown") {
        events.push(normalizeSessionCompleted(session, terminal.at, terminal.duration, context));
      }
      if (rollout.latestTokenObservation !== undefined) {
        events.push(normalizeUsage(session, rollout.latestTokenObservation, context));
      }
    }

    for (const edge of edges) {
      const child = sessionMap.get(edge.childSessionId);
      if (child !== undefined) events.push(normalizeSpawned(edge, child.startedAt, context));
    }

    const usageSnapshotsObserved = events.filter(
      (event) => event.eventType === "codex.usage.recorded",
    ).length;
    return {
      sourceInstanceId: sourceId,
      sourceFormatVersion: formatVersion,
      schemaFingerprint,
      sessions,
      edges,
      events: deduplicateEvents(events),
      coverage: {
        source: "codex_local_experimental",
        supported: false,
        completeness: "partial",
        observedAt,
        schemaFingerprint,
        sourceFormatVersion: formatVersion,
        threadsObserved: sessions.length,
        rolloutFilesRead,
        usageSnapshotsObserved,
        sessionsMissingCounters,
        malformedMetadataLines,
        reason: "Experimental metadata-only adapter over undocumented local Codex formats",
      },
      warnings,
    };
  }
}
