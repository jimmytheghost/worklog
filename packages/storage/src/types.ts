import type { Completeness, Freshness, SourceSystem } from "@agent-dashboard/domain";

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
