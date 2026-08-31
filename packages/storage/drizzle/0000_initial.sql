CREATE TABLE `sources` (
  `id` text PRIMARY KEY NOT NULL,
  `system` text NOT NULL,
  `immutable_source_id` text NOT NULL,
  `display_name` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `sources_system_immutable_unique` UNIQUE (`system`, `immutable_source_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `immutable_source_id` text NOT NULL,
  `name` text NOT NULL,
  `owner` text,
  `default_branch` text,
  `visibility` text NOT NULL DEFAULT 'unknown',
  `archived` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `projects_source_immutable_unique` UNIQUE (`source_id`, `immutable_source_id`)
);
--> statement-breakpoint
CREATE INDEX `projects_source_idx` ON `projects` (`source_id`);
--> statement-breakpoint
CREATE TABLE `normalized_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `schema_version` integer NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `repository_id` text,
  `task_id` text,
  `session_id` text,
  `occurred_at` text NOT NULL,
  `occurred_at_source` text NOT NULL,
  `observed_at` text NOT NULL,
  `source_system` text NOT NULL,
  `source_account_id` text NOT NULL,
  `source_record_id` text NOT NULL,
  `adapter_name` text NOT NULL,
  `adapter_version` text NOT NULL,
  `source_format_version` text,
  `idempotency_key` text NOT NULL UNIQUE,
  `attribution` text NOT NULL,
  `confidence` text NOT NULL,
  `completeness` text NOT NULL,
  `payload_json` text NOT NULL,
  `raw_record_hash` text
);
--> statement-breakpoint
CREATE INDEX `normalized_events_occurred_at_idx` ON `normalized_events` (`occurred_at`);
--> statement-breakpoint
CREATE INDEX `normalized_events_type_occurred_at_idx` ON `normalized_events` (`event_type`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX `normalized_events_repository_idx` ON `normalized_events` (`repository_id`);
--> statement-breakpoint
CREATE TABLE `sync_cursors` (
  `source_id` text NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `adapter_name` text NOT NULL,
  `cursor_json` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`source_id`, `adapter_name`)
);
--> statement-breakpoint
CREATE TABLE `source_coverage` (
  `coverage_key` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `metric` text NOT NULL,
  `entity_type` text,
  `entity_id` text,
  `coverage_start` text,
  `coverage_end` text,
  `completeness` text NOT NULL,
  `coverage_reason` text,
  `last_attempted_at` text,
  `last_succeeded_at` text,
  `latest_error` text,
  `expected_sync_interval_ms` integer,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_coverage_source_metric_idx` ON `source_coverage` (`source_id`, `metric`);
