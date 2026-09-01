import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    system: text("system").notNull(),
    immutableSourceId: text("immutable_source_id").notNull(),
    displayName: text("display_name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [unique("sources_system_immutable_unique").on(table.system, table.immutableSourceId)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    immutableSourceId: text("immutable_source_id").notNull(),
    name: text("name").notNull(),
    owner: text("owner"),
    defaultBranch: text("default_branch"),
    visibility: text("visibility").notNull().default("unknown"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("projects_source_immutable_unique").on(table.sourceId, table.immutableSourceId),
    index("projects_source_idx").on(table.sourceId),
  ],
);

export const normalizedEvents = sqliteTable(
  "normalized_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    repositoryId: text("repository_id"),
    taskId: text("task_id"),
    sessionId: text("session_id"),
    occurredAt: text("occurred_at").notNull(),
    occurredAtSource: text("occurred_at_source").notNull(),
    observedAt: text("observed_at").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    adapterName: text("adapter_name").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    sourceFormatVersion: text("source_format_version"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    attribution: text("attribution").notNull(),
    confidence: text("confidence").notNull(),
    completeness: text("completeness").notNull(),
    payloadJson: text("payload_json").notNull(),
    rawRecordHash: text("raw_record_hash"),
  },
  (table) => [
    index("normalized_events_occurred_at_idx").on(table.occurredAt),
    index("normalized_events_type_occurred_at_idx").on(table.eventType, table.occurredAt),
    index("normalized_events_repository_idx").on(table.repositoryId),
  ],
);

export const syncCursors = sqliteTable(
  "sync_cursors",
  {
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    adapterName: text("adapter_name").notNull(),
    cursorJson: text("cursor_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.adapterName] })],
);

export const sourceCoverage = sqliteTable(
  "source_coverage",
  {
    coverageKey: text("coverage_key").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    coverageStart: text("coverage_start"),
    coverageEnd: text("coverage_end"),
    completeness: text("completeness").notNull(),
    coverageReason: text("coverage_reason"),
    lastAttemptedAt: text("last_attempted_at"),
    lastSucceededAt: text("last_succeeded_at"),
    latestError: text("latest_error"),
    expectedSyncIntervalMs: integer("expected_sync_interval_ms"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("source_coverage_source_metric_idx").on(table.sourceId, table.metric)],
);

export const codexAccountState = sqliteTable("codex_account_state", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => sources.id, { onDelete: "cascade" }),
  observedAt: text("observed_at").notNull(),
  payloadJson: text("payload_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});
