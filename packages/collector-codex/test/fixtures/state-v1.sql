CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  rollout_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cwd TEXT NOT NULL,
  model TEXT,
  reasoning_effort TEXT,
  agent_role TEXT,
  created_at_ms INTEGER,
  updated_at_ms INTEGER,
  title TEXT NOT NULL DEFAULT '',
  first_user_message TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  tokens_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE thread_spawn_edges (
  parent_thread_id TEXT NOT NULL,
  child_thread_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL
);
