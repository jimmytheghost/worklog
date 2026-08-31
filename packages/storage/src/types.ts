import type {
  AgentRole,
  Completeness,
  Freshness,
  ReasoningEffort,
  SourceSystem,
} from "@agent-dashboard/domain";

export interface SourceInput {
  id: string;
  system: SourceSystem;
  immutableSourceId: string;
  displayName?: string | undefined;
}

export interface ProjectInput {
  id: string;
  sourceId: string;
  immutableSourceId: string;
  name: string;
  owner?: string | undefined;
  defaultBranch?: string | undefined;
  visibility?: "public" | "private" | "internal" | "unknown" | undefined;
  archived?: boolean | undefined;
}

export interface ProjectSummary {
  id: string;
  name: string;
  owner: string | null;
  defaultBranch: string | null;
  visibility: "public" | "private" | "internal" | "unknown";
  updatedAt: string;
}

export interface SyncCursorInput {
  sourceId: string;
  adapterName: string;
  cursor: unknown;
}

export interface SourceCoverageInput {
  coverageKey: string;
  sourceId: string;
  metric: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  coverageStart?: string | undefined;
  coverageEnd?: string | undefined;
  completeness: Completeness;
  coverageReason?: string | undefined;
  lastAttemptedAt?: string | undefined;
  lastSucceededAt?: string | undefined;
  latestError?: string | undefined;
  expectedSyncIntervalMs?: number | undefined;
}

export interface SourceCoverageResult extends SourceCoverageInput {
  freshness: Freshness;
  updatedAt: string;
}

export interface DailyGitActivity {
  localDate: string;
  commits: number;
  pushes: number;
}

export interface DailyGitActivityQuery {
  startLocalDate: string;
  endLocalDateExclusive: string;
  timeZone?: string | undefined;
  repositoryIds?: readonly string[] | undefined;
}

export type CodexSessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "unknown";

export interface CodexSessionReadModel {
  id: string;
  taskId: string | null;
  parentSessionId: string | null;
  repositoryId: string | null;
  label: string | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  role: AgentRole;
  status: CodexSessionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMilliseconds: number | null;
  totalObservedTokens: number | null;
}

export interface CodexTaskReadModel {
  id: string;
  repositoryId: string | null;
  label: string | null;
  primarySessionId: string | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  status: CodexSessionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMilliseconds: number | null;
  totalObservedTokens: number | null;
  sessionIds: string[];
}

export type CodexTokenKnowledge = "complete" | "partial" | "unknown";

export interface CodexObservedTokenQuery {
  /** Inclusive UTC instant. Sessions are matched by their start instant. */
  start: string;
  /** Exclusive UTC instant. Usage snapshots at this instant belong to the next interval. */
  end: string;
}

export interface CodexObservedTokenResult {
  /** Sum of trustworthy latest cumulative snapshots; never substitutes zero for unknown sessions. */
  knownSubtotal: number;
  knowledge: CodexTokenKnowledge;
  sessionsObserved: number;
  sessionsKnown: number;
  sessionsUnknown: number;
}
