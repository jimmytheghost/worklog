import { appendFileSync, copyFileSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { parseNormalizedEvent } from "@agent-dashboard/domain";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  CodexCollector,
  isPrivacySafeCodexEvent,
} from "../src/index.js";
import { readCodexIndex } from "../src/sqlite.js";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const NOW = new Date("2026-08-31T12:00:00Z");
const createdRoots: string[] = [];

interface FixtureRoot {
  root: string;
  stateDatabase: string;
  historyDatabase: string;
}

async function fixtureRoot(): Promise<FixtureRoot> {
  const root = await mkdtemp(join(tmpdir(), "agent-dashboard-codex-fixture-"));
  createdRoots.push(root);
  mkdirSync(join(root, "sessions"));
  const stateDatabase = join(root, "state_5.sqlite");
  const historyDatabase = join(root, "thread_history_1.sqlite");
  const state = new BetterSqlite3(stateDatabase);
  state.exec(readFileSync(new URL("state-v1.sql", FIXTURES), "utf8"));
  const primaryRollout = join(root, "sessions", "rollout-primary.jsonl");
  const childRollout = join(root, "sessions", "rollout-child.jsonl");
  const missingRollout = join(root, "sessions", "rollout-missing.jsonl");
  copyFileSync(new URL("rollout-primary.jsonl", FIXTURES), primaryRollout);
  copyFileSync(new URL("rollout-child.jsonl", FIXTURES), childRollout);
  copyFileSync(new URL("rollout-missing-counters.jsonl", FIXTURES), missingRollout);
  const insertThread = state.prepare(
    `INSERT INTO threads
      (id, rollout_path, created_at, updated_at, cwd, model, reasoning_effort, agent_role, title, first_user_message, preview, tokens_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertThread.run(
    "session-primary",
    primaryRollout,
    1788051600,
    1788051840,
    "/fixture/workspace-primary",
    "gpt-fixture",
    "high",
    "primary",
    "",
    "",
    "",
    27,
  );
  insertThread.run(
    "session-child",
    childRollout,
    1788055200,
    1788055260,
    "/fixture/workspace-child",
    "gpt-fixture",
    "medium",
    "worker",
    "",
    "",
    "",
    0,
  );
  insertThread.run(
    "session-missing",
    missingRollout,
    1788058800,
    1788058860,
    "/fixture/workspace-missing",
    null,
    "future-effort",
    null,
    "",
    "",
    "",
    11,
  );
  state
    .prepare(
      "INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status) VALUES (?, ?, ?)",
    )
    .run("session-primary", "session-child", "open");
  state.close();

  const history = new BetterSqlite3(historyDatabase);
  history.exec(readFileSync(new URL("history-v1.sql", FIXTURES), "utf8"));
  history
    .prepare(
      "INSERT INTO thread_turns (thread_id, turn_id, rollout_ordinal, status, started_at, completed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("session-primary", "turn-1", 1, "completed", 1788051600, 1788051840, 240000);
  history
    .prepare(
      "INSERT INTO thread_turns (thread_id, turn_id, rollout_ordinal, status, started_at, completed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("session-child", "turn-2", 1, "completed", 1788055200, 1788055260, 60000);
  history.close();
  return { root, stateDatabase, historyDatabase };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodexCollector", () => {
  it("normalizes strict metadata while excluding all private content fields", async () => {
    const fixture = await fixtureRoot();
    const before = statSync(fixture.stateDatabase);
    const result = await new CodexCollector({ codexRoot: fixture.root, now: () => NOW }).collect();
    const after = statSync(fixture.stateDatabase);

    expect(result.coverage).toMatchObject({
      source: "codex_local_experimental",
      supported: false,
      completeness: "partial",
      threadsObserved: 3,
    });
    expect(result.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSessionId: "session-primary",
          model: "gpt-fixture",
          reasoningEffort: "high",
          agentRole: "primary",
          status: "completed",
        }),
        expect.objectContaining({
          sourceSessionId: "session-child",
          reasoningEffort: "medium",
          agentRole: "subagent",
          parentSessionId: "session-primary",
        }),
        expect.objectContaining({
          sourceSessionId: "session-missing",
          reasoningEffort: "unknown",
        }),
      ]),
    );
    expect(result.events.every(isPrivacySafeCodexEvent)).toBe(true);
    expect(result.events.every((event) => parseNormalizedEvent(event) !== undefined)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("FORBIDDEN_FIXTURE_CONTENT");
    expect(JSON.stringify(result)).not.toContain("workspace-primary");
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("reuses unchanged metadata, rereads edits, and invalidates missing files", async () => {
    const fixture = await fixtureRoot();
    const collector = new CodexCollector({ codexRoot: fixture.root, now: () => NOW });
    const first = await collector.collect();
    expect(first.coverage.rolloutFilesRead).toBe(3);
    const unchanged = await collector.collect();
    expect(unchanged.coverage.rolloutFilesRead).toBe(0);
    expect(unchanged.events).toEqual(first.events);
    expect(unchanged.warnings).toEqual(first.warnings);

    const path = join(fixture.root, "sessions", "rollout-primary.jsonl");
    appendFileSync(path, '\n{"timestamp":"2026-08-30T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":null}}\n');
    const changed = await collector.collect();
    expect(changed.coverage.rolloutFilesRead).toBe(1);
    expect(changed.events.find((event) => event.eventType === "codex.usage.recorded" && event.sessionId === "session-primary")?.payload).toMatchObject({ countersAvailable: false });

    unlinkSync(path);
    const missing = await collector.collect();
    expect(missing.warnings).toContainEqual(expect.objectContaining({ code: "rollout_missing", sessionId: "session-primary" }));
    expect(missing.events.some((event) => event.eventType === "codex.usage.recorded" && event.sessionId === "session-primary")).toBe(false);
    copyFileSync(new URL("rollout-primary.jsonl", FIXTURES), path);
    const restored = await collector.collect();
    expect(restored.coverage.rolloutFilesRead).toBe(1);
    expect(restored.events).toEqual(first.events);
  });

  it("selects only the latest cumulative token snapshot for a session", async () => {
    const fixture = await fixtureRoot();
    const result = await new CodexCollector({ codexRoot: fixture.root, now: () => NOW }).collect();
    const usage = result.events.filter(
      (event) =>
        event.eventType === "codex.usage.recorded" && event.sessionId === "session-primary",
    );

    expect(usage).toHaveLength(1);
    expect(usage[0]?.payload).toEqual({
      counterKind: "cumulative",
      sourceSessionId: "session-primary",
      countersAvailable: true,
      inputTokens: 20,
      cachedTokens: 5,
      cacheWriteTokens: 2,
      outputTokens: 7,
      reasoningTokens: 3,
      totalTokens: 27,
      bucketStart: "2026-08-30T01:00:00.000Z",
      bucketEnd: "2026-08-30T01:03:00.000Z",
    });
  });

  it("emits counters-unavailable instead of preserving stale values or manufacturing zeroes", async () => {
    const fixture = await fixtureRoot();
    const result = await new CodexCollector({ codexRoot: fixture.root, now: () => NOW }).collect();

    const usage = result.events.find(
      (event) =>
        event.eventType === "codex.usage.recorded" && event.sessionId === "session-missing",
    );
    expect(usage?.payload).toEqual({
      counterKind: "cumulative",
      sourceSessionId: "session-missing",
      countersAvailable: false,
      bucketStart: "2026-08-30T03:00:00.000Z",
      bucketEnd: "2026-08-30T03:01:00.000Z",
    });
    expect(result.coverage.sessionsMissingCounters).toBe(1);
    expect(result.warnings).toContainEqual({
      code: "missing_counters",
      sessionId: "session-missing",
      message: "Cumulative token counters are incomplete and marked unavailable",
    });
  });

  it("supersedes a complete counter snapshot when a later sync observes incomplete counters", async () => {
    const fixture = await fixtureRoot();
    const collector = new CodexCollector({ codexRoot: fixture.root, now: () => NOW });
    const first = await collector.collect();
    const firstUsage = first.events.find(
      (event) =>
        event.eventType === "codex.usage.recorded" && event.sessionId === "session-primary",
    );
    expect(firstUsage?.payload).toMatchObject({ countersAvailable: true, totalTokens: 27 });

    appendFileSync(
      join(fixture.root, "sessions", "rollout-primary.jsonl"),
      '\n{"timestamp":"2026-08-30T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":30,"total_tokens":30}}}}\n',
    );
    const second = await collector.collect();
    const secondUsage = second.events.find(
      (event) =>
        event.eventType === "codex.usage.recorded" && event.sessionId === "session-primary",
    );

    expect(secondUsage?.eventId).not.toBe(firstUsage?.eventId);
    expect(secondUsage?.payload).toEqual({
      counterKind: "cumulative",
      sourceSessionId: "session-primary",
      countersAvailable: false,
      bucketStart: "2026-08-30T01:00:00.000Z",
      bucketEnd: "2026-08-30T01:05:00.000Z",
    });
  });

  it("emits a newer active state observation when a completed session is reopened", async () => {
    const fixture = await fixtureRoot();
    const collector = new CodexCollector({ codexRoot: fixture.root, now: () => NOW });
    const first = await collector.collect();
    const completedState = first.events.find(
      (event) =>
        event.eventType === "codex.session.state_observed" && event.sessionId === "session-primary",
    );
    expect(completedState?.payload).toMatchObject({ status: "completed" });
    const unchanged = await collector.collect();
    const unchangedState = unchanged.events.find(
      (event) =>
        event.eventType === "codex.session.state_observed" && event.sessionId === "session-primary",
    );
    expect(unchangedState?.eventId).toBe(completedState?.eventId);

    const reopenedAt = Math.floor(Date.parse("2026-08-31T11:00:00Z") / 1_000);
    const state = new BetterSqlite3(fixture.stateDatabase);
    state.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(reopenedAt, "session-primary");
    state.close();
    const history = new BetterSqlite3(fixture.historyDatabase);
    history
      .prepare(
        "INSERT INTO thread_turns (thread_id, turn_id, rollout_ordinal, status, started_at, completed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("session-primary", "turn-reopened", 2, "running", reopenedAt, null, null);
    history.close();
    appendFileSync(
      join(fixture.root, "sessions", "rollout-primary.jsonl"),
      '\n{"timestamp":"2026-08-31T11:00:00Z","type":"event_msg","payload":{"type":"task_started","started_at":"2026-08-31T11:00:00Z"}}\n',
    );

    const second = await collector.collect();
    const activeState = second.events.find(
      (event) =>
        event.eventType === "codex.session.state_observed" && event.sessionId === "session-primary",
    );
    expect(activeState?.eventId).not.toBe(completedState?.eventId);
    expect(activeState).toMatchObject({
      occurredAt: "2026-08-31T11:00:00.000Z",
      payload: { sourceSessionId: "session-primary", status: "active" },
    });
    expect(
      second.events.some(
        (event) =>
          event.eventType === "codex.session.completed" && event.sessionId === "session-primary",
      ),
    ).toBe(false);
  });

  it("marks an indexed open edge stale when its child is terminal", async () => {
    const fixture = await fixtureRoot();
    const result = await new CodexCollector({ codexRoot: fixture.root, now: () => NOW }).collect();

    expect(result.edges).toEqual([
      {
        parentSessionId: "session-primary",
        childSessionId: "session-child",
        reportedStatus: "open",
        resolvedStatus: "stale",
        reason: "Indexed edge is open but the child session is terminal",
      },
    ]);
  });

  it("rejects required-column schema drift with a sanitized error", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-dashboard-codex-drift-"));
    createdRoots.push(root);
    const filename = join(root, "state_99.sqlite");
    const database = new BetterSqlite3(filename);
    database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, created_at INTEGER, updated_at INTEGER, cwd TEXT)");
    database.close();

    await expect(new CodexCollector({ codexRoot: root, now: () => NOW }).collect()).rejects.toMatchObject({
      name: "CodexCollectorError",
      code: "unsupported_schema",
      message: "Unsupported Codex thread index schema; missing rollout_path",
    });
  });

  it("tolerates additive schema drift and fingerprints the detected format", async () => {
    const fixture = await fixtureRoot();
    const database = new BetterSqlite3(fixture.stateDatabase);
    database.exec("ALTER TABLE threads ADD COLUMN future_metadata TEXT");
    database.close();
    const baseline = readCodexIndex(fixture.stateDatabase, fixture.historyDatabase);
    expect(baseline.stateSchema.tables.threads).toContain("future_metadata");

    const result = await new CodexCollector({ codexRoot: fixture.root, now: () => NOW }).collect();
    expect(result.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sourceFormatVersion).toMatch(/^codex-local-experimental-v1\.[0-9a-f]{16}$/);
  });
});
