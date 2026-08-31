import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { CodexCollectorError } from "./errors.js";

export interface ResolvedCodexPaths {
  root: string;
  stateDatabase: string;
  historyDatabase?: string;
}

function latestVersionedDatabase(root: string, prefix: string): string | undefined {
  const pattern = new RegExp(`^${prefix}_(\\d+)\\.sqlite$`);
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, match: pattern.exec(entry.name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .sort((left, right) => Number(right.match[1]) - Number(left.match[1]));
  return candidates[0] === undefined ? undefined : join(root, candidates[0].name);
}

export function resolveCodexPaths(options: {
  codexRoot?: string;
  stateDatabasePath?: string;
  historyDatabasePath?: string;
}): ResolvedCodexPaths {
  const root = resolve(options.codexRoot ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  if (!existsSync(root)) {
    throw new CodexCollectorError("source_missing", "Codex data root is unavailable");
  }

  const stateDatabase =
    options.stateDatabasePath === undefined
      ? latestVersionedDatabase(root, "state")
      : resolve(options.stateDatabasePath);
  if (stateDatabase === undefined || !existsSync(stateDatabase)) {
    throw new CodexCollectorError("source_missing", "Codex state index is unavailable");
  }

  const discoveredHistory =
    options.historyDatabasePath === undefined
      ? latestVersionedDatabase(root, "thread_history")
      : resolve(options.historyDatabasePath);

  return {
    root,
    stateDatabase,
    ...(discoveredHistory === undefined || !existsSync(discoveredHistory)
      ? {}
      : { historyDatabase: discoveredHistory }),
  };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sourceInstanceId(root: string): string {
  return `codex-local:${sha256(resolve(root))}`;
}

export function workspaceIdentityHash(workspacePath: string): string {
  return sha256(resolve(workspacePath));
}
