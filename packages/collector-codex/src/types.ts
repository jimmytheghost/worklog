import type {
  AgentRole,
  AnyNormalizedEvent,
  Completeness,
  ReasoningEffort,
} from "@agent-dashboard/domain";

export type CodexSessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "unknown";

export interface CodexThreadRecord {
  id: string;
  rolloutPath: string;
  createdAt: string;
  updatedAt: string;
  workspaceIdentityHash: string;
  model?: string;
  reasoningEffort: ReasoningEffort;
  indexedAgentRole?: string;
}

export interface CodexTurnRecord {
  threadId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMilliseconds?: number;
}

export interface CodexSpawnEdgeRecord {
  parentSessionId: string;
  childSessionId: string;
  reportedStatus: string;
}

export interface CodexIndexSnapshot {
  threads: CodexThreadRecord[];
  latestTurns: CodexTurnRecord[];
  spawnEdges: CodexSpawnEdgeRecord[];
  stateSchema: SourceSchemaDescription;
  historySchema?: SourceSchemaDescription;
}

export interface SourceSchemaDescription {
  userVersion: number;
  tables: Record<string, string[]>;
}

interface CumulativeTokenObservationBase {
  lineNumber: number;
  observedAt: string;
}

export interface AvailableCumulativeTokenObservation extends CumulativeTokenObservationBase {
  countersAvailable: true;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface UnavailableCumulativeTokenObservation extends CumulativeTokenObservationBase {
  countersAvailable: false;
}

export type CumulativeTokenObservation =
  | AvailableCumulativeTokenObservation
  | UnavailableCumulativeTokenObservation;

export interface RolloutMetadata {
  latestTokenObservation?: CumulativeTokenObservation;
  parentSessionId?: string;
  terminalStatus?: CodexSessionStatus;
  terminalAt?: string;
  terminalDurationMilliseconds?: number;
  malformedMetadataLines: number;
  missingCumulativeCounters: boolean;
}

export interface CodexSessionMetadata {
  sourceSessionId: string;
  startedAt: string;
  updatedAt: string;
  status: CodexSessionStatus;
  model?: string;
  reasoningEffort: ReasoningEffort;
  agentRole: AgentRole;
  parentSessionId?: string;
  workspaceIdentityHash: string;
}

export type ResolvedEdgeStatus = "open" | "closed" | "stale" | "unknown";

export interface ResolvedCodexEdge extends CodexSpawnEdgeRecord {
  resolvedStatus: ResolvedEdgeStatus;
  reason?: string;
}

export interface CodexCoverage {
  source: "codex_local_experimental";
  supported: false;
  completeness: Completeness;
  observedAt: string;
  schemaFingerprint: string;
  sourceFormatVersion: string;
  threadsObserved: number;
  rolloutFilesRead: number;
  usageSnapshotsObserved: number;
  sessionsMissingCounters: number;
  malformedMetadataLines: number;
  reason: string;
}

export type CodexCollectorErrorCode =
  | "source_missing"
  | "unsupported_schema"
  | "read_failed";

export interface CodexCollectionWarning {
  code: "rollout_missing" | "rollout_outside_root" | "rollout_unreadable" | "missing_counters";
  sessionId: string;
  message: string;
}

export interface CodexCollectionResult {
  sourceInstanceId: string;
  sourceFormatVersion: string;
  schemaFingerprint: string;
  sessions: CodexSessionMetadata[];
  edges: ResolvedCodexEdge[];
  events: AnyNormalizedEvent[];
  coverage: CodexCoverage;
  warnings: CodexCollectionWarning[];
}

export interface CodexCollectorOptions {
  codexRoot?: string;
  stateDatabasePath?: string;
  historyDatabasePath?: string;
  now?: () => Date;
  staleEdgeAfterMilliseconds?: number;
}
