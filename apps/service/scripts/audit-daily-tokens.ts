// Run only against a disposable SQLite backup. This tool never starts a service or publisher.
import { writeFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { CodexCollector } from "@agent-dashboard/collector-codex";
import { openStorage } from "@agent-dashboard/storage";
import { CodexSyncCoordinator } from "../src/codex-sync.js";
import { ServiceEventHub } from "../src/events.js";
import { buildPublicActivity } from "../src/public-activity.js";

const [database, output] = process.argv.slice(2);
if (!database || !output) throw new Error("Usage: tsx scripts/audit-daily-tokens.ts BACKUP.sqlite PRIVATE_OUTPUT.json");
const live = resolve(homedir(), ".agent-dashboard/agent-dashboard.sqlite");
const inputStat = statSync(database), liveStat = statSync(live);
if (realpathSync(database) === realpathSync(live) || (inputStat.dev === liveStat.dev && inputStat.ino === liveStat.ino)) throw new Error("Use an isolated backup, never the live ledger");
const storage = openStorage({ filename: resolve(database) });
const now = new Date();
const zone = "America/Denver";
const recentStart = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
const summarize = () => {
  const feed = buildPublicActivity(storage, zone, now);
  const tokens = feed.months.flatMap(month => month.tokenDays);
  const agents = feed.months.flatMap(month => month.agentDays);
  const tokenDates = new Map(tokens.map(day => [day.localDate, day]));
  return { feed, counts: {
    events: storage.countEvents(), activityDates: agents.length, tokenDates: tokens.length,
    activityDatesWithKnownTokens: agents.filter(day => tokenDates.get(day.localDate)?.tokens != null).length,
    completeDates: tokens.filter(day => day.tokensKnowledge === "complete").length,
    partialDates: tokens.filter(day => day.tokensKnowledge === "partial").length,
    unknownDates: tokens.filter(day => day.tokensKnowledge === "unknown").length,
    knownZeroDates: tokens.filter(day => day.tokens === 0).length,
    firstDate: tokens.map(day => day.localDate).sort()[0], recentDays: tokens.filter(day => day.localDate >= recentStart),
  } };
};
try {
  const before = summarize();
  const collection = await new CodexCollector({ now: () => now }).collect();
  const sync = new CodexSyncCoordinator(storage, { collect: async () => collection }, new ServiceEventHub(), () => now);
  const first = await sync.sync();
  const after = summarize();
  const second = await sync.sync();
  const replay = summarize();
  const stable = JSON.stringify(after) === JSON.stringify(replay);
  writeFileSync(output, JSON.stringify(after.feed), { mode: 0o600 });
  console.log(JSON.stringify({ observedAt: now.toISOString(), before: before.counts, after: after.counts,
    collection: { sessions: collection.sessions.length, buckets: collection.tokenBuckets?.length,
      filesRead: collection.coverage.rolloutFilesRead, malformedLines: collection.coverage.malformedMetadataLines,
      warnings: collection.warnings.length,
      warningCodes: Object.fromEntries([...new Set(collection.warnings.map(warning => warning.code))]
        .map(code => [code, collection.warnings.filter(warning => warning.code === code).length])) },
    first: { status: first.status, inserted: first.insertedEvents, ignored: first.ignoredEvents },
    replay: { status: second.status, inserted: second.insertedEvents, ignored: second.ignoredEvents, stable },
  }, null, 2));
  if (!stable || first.status === "failed" || second.status === "failed") process.exitCode = 1;
} finally { storage.close(); }
