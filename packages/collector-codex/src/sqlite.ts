import { execFileSync } from "node:child_process";

import BetterSqlite3 from "better-sqlite3";

import { CodexCollectorError, sanitizedReadError } from "./errors.js";
import { workspaceIdentityHash } from "./paths.js";
import type {
  CodexIndexSnapshot,
  CodexSpawnEdgeRecord,
  CodexThreadRecord,
  CodexTurnRecord,
  SourceSchemaDescription,
} from "./types.js";

const REQUIRED_THREAD_COLUMNS = ["id", "rollout_path", "created_at", "updated_at", "cwd"];

function githubRepositorySlug(workspace: string): string | undefined {
  let remote: string;
  try {
    remote = execFileSync("git", ["-C", workspace, "config", "--get", "remote.origin.url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_000,
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
  const match = /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(remote);
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

function schemaDescription(database: BetterSqlite3.Database): SourceSchemaDescription {
  const userVersion = database.pragma("user_version", { simple: true }) as number;
  const tableRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const tables: Record<string, string[]> = {};
  for (const { name } of tableRows) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    const columns = database.pragma(`table_info(${name})`) as Array<{ name: string }>;
    tables[name] = columns.map((column) => column.name).sort();
  }
  return { userVersion, tables };
}

function optionalColumn(columns: ReadonlySet<string>, name: string, fallback = "NULL"): string {
  return columns.has(name) ? name : `${fallback} AS ${name}`;
}

function instantFromEpoch(value: unknown, millisecondsValue?: unknown): string {
  const milliseconds =
    typeof millisecondsValue === "number"
      ? millisecondsValue
      : typeof value === "number"
        ? value * 1_000
        : Number.NaN;
  if (!Number.isFinite(milliseconds)) {
    throw new CodexCollectorError("unsupported_schema", "Codex index contains an invalid timestamp");
  }
  return new Date(milliseconds).toISOString();
}

function openReadonly(filename: string): BetterSqlite3.Database {
  try {
    const database = new BetterSqlite3(filename, { readonly: true, fileMustExist: true });
    database.pragma("query_only = ON");
    return database;
  } catch (error) {
    throw sanitizedReadError(error);
  }
}

interface ThreadRow {
  id: unknown;
  rollout_path: unknown;
  created_at: unknown;
  updated_at: unknown;
  cwd: unknown;
  model: unknown;
  reasoning_effort: unknown;
  agent_role: unknown;
  created_at_ms: unknown;
  updated_at_ms: unknown;
}

function readThreads(database: BetterSqlite3.Database, schema: SourceSchemaDescription): CodexThreadRecord[] {
  const threadColumns = new Set(schema.tables.threads ?? []);
  const missing = REQUIRED_THREAD_COLUMNS.filter((column) => !threadColumns.has(column));
  if (missing.length > 0) {
    throw new CodexCollectorError(
      "unsupported_schema",
      `Unsupported Codex thread index schema; missing ${missing.join(", ")}`,
    );
  }
  const sql = `SELECT id, rollout_path, created_at, updated_at, cwd,
    ${optionalColumn(threadColumns, "model")},
    ${optionalColumn(threadColumns, "reasoning_effort")},
    ${optionalColumn(threadColumns, "agent_role")},
    ${optionalColumn(threadColumns, "created_at_ms")},
    ${optionalColumn(threadColumns, "updated_at_ms")}
    FROM threads ORDER BY created_at ASC, id ASC`;
  const rows = database.prepare(sql).all() as ThreadRow[];
  const repositoryByWorkspace = new Map<string, string | undefined>();
  return rows.map((row) => {
    if (
      typeof row.id !== "string" ||
      typeof row.rollout_path !== "string" ||
      typeof row.cwd !== "string"
    ) {
      throw new CodexCollectorError("unsupported_schema", "Codex thread index has invalid metadata");
    }
    if (!repositoryByWorkspace.has(row.cwd)) {
      repositoryByWorkspace.set(row.cwd, githubRepositorySlug(row.cwd));
    }
    const repositorySlug = repositoryByWorkspace.get(row.cwd);
    return {
      id: row.id,
      rolloutPath: row.rollout_path,
      createdAt: instantFromEpoch(row.created_at, row.created_at_ms),
      updatedAt: instantFromEpoch(row.updated_at, row.updated_at_ms),
      workspaceIdentityHash: workspaceIdentityHash(row.cwd),
      ...(repositorySlug === undefined ? {} : { repositorySlug }),
      ...(typeof row.model === "string" && row.model.length > 0 ? { model: row.model } : {}),
      reasoningEffort:
        typeof row.reasoning_effort === "string"
          ? normalizeReasoningEffort(row.reasoning_effort)
          : "unknown",
      ...(typeof row.agent_role === "string" && row.agent_role.length > 0
        ? { indexedAgentRole: row.agent_role }
        : {}),
    };
  });
}

function normalizeReasoningEffort(value: string): CodexThreadRecord["reasoningEffort"] {
  return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value)
    ? (value as CodexThreadRecord["reasoningEffort"])
    : "unknown";
}

function readEdges(
  database: BetterSqlite3.Database,
  schema: SourceSchemaDescription,
): CodexSpawnEdgeRecord[] {
  const columns = new Set(schema.tables.thread_spawn_edges ?? []);
  if (!["parent_thread_id", "child_thread_id", "status"].every((column) => columns.has(column))) {
    return [];
  }
  return database
    .prepare(
      "SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges ORDER BY parent_thread_id, child_thread_id",
    )
    .all()
    .flatMap((row) => {
      const value = row as Record<string, unknown>;
      return typeof value.parent_thread_id === "string" &&
        typeof value.child_thread_id === "string" &&
        typeof value.status === "string"
        ? [
            {
              parentSessionId: value.parent_thread_id,
              childSessionId: value.child_thread_id,
              reportedStatus: value.status,
            },
          ]
        : [];
    });
}

function readLatestTurns(
  filename: string | undefined,
): { turns: CodexTurnRecord[]; schema?: SourceSchemaDescription } {
  if (filename === undefined) return { turns: [] };
  const database = openReadonly(filename);
  try {
    const schema = schemaDescription(database);
    const columns = new Set(schema.tables.thread_turns ?? []);
    if (!["thread_id", "status", "rollout_ordinal"].every((column) => columns.has(column))) {
      return { turns: [], schema };
    }
    const sql = `SELECT thread_id, status,
      ${optionalColumn(columns, "started_at")},
      ${optionalColumn(columns, "completed_at")},
      ${optionalColumn(columns, "duration_ms")}
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY rollout_ordinal DESC) AS row_number
        FROM thread_turns
      ) WHERE row_number = 1 ORDER BY thread_id`;
    const rows = database.prepare(sql).all() as Array<Record<string, unknown>>;
    const turns = rows.flatMap((row): CodexTurnRecord[] => {
      if (typeof row.thread_id !== "string" || typeof row.status !== "string") return [];
      return [
        {
          threadId: row.thread_id,
          status: row.status,
          ...(typeof row.started_at === "number"
            ? { startedAt: instantFromEpoch(row.started_at) }
            : {}),
          ...(typeof row.completed_at === "number"
            ? { completedAt: instantFromEpoch(row.completed_at) }
            : {}),
          ...(typeof row.duration_ms === "number" && row.duration_ms >= 0
            ? { durationMilliseconds: row.duration_ms }
            : {}),
        },
      ];
    });
    return { turns, schema };
  } finally {
    database.close();
  }
}

export function readCodexIndex(
  stateDatabaseFilename: string,
  historyDatabaseFilename?: string,
): CodexIndexSnapshot {
  const stateDatabase = openReadonly(stateDatabaseFilename);
  try {
    const stateSchema = schemaDescription(stateDatabase);
    if (stateSchema.tables.threads === undefined) {
      throw new CodexCollectorError("unsupported_schema", "Unsupported Codex index: threads table missing");
    }
    const threads = readThreads(stateDatabase, stateSchema);
    const spawnEdges = readEdges(stateDatabase, stateSchema);
    const history = readLatestTurns(historyDatabaseFilename);
    return {
      threads,
      spawnEdges,
      latestTurns: history.turns,
      stateSchema,
      ...(history.schema === undefined ? {} : { historySchema: history.schema }),
    };
  } catch (error) {
    throw sanitizedReadError(error);
  } finally {
    stateDatabase.close();
  }
}
