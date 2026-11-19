CREATE TABLE codex_token_minutes (
  session_id TEXT NOT NULL,
  instant TEXT NOT NULL,
  tokens INTEGER,
  partial INTEGER NOT NULL,
  PRIMARY KEY (instant, session_id)
) WITHOUT ROWID;
