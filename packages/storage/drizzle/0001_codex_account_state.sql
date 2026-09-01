CREATE TABLE `codex_account_state` (
  `source_id` text PRIMARY KEY NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `observed_at` text NOT NULL,
  `payload_json` text NOT NULL,
  `updated_at` text NOT NULL
);
