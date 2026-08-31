CREATE TABLE thread_turns (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  rollout_ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  duration_ms INTEGER,
  PRIMARY KEY (thread_id, turn_id)
);
