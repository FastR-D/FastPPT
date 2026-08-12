CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entry_file TEXT NOT NULL,
  name TEXT NOT NULL,
  theme_id TEXT,
  revision TEXT NOT NULL,
  modified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  harness TEXT NOT NULL,
  session_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY NOT NULL,
  harness TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  decision TEXT,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS managed_installations (
  id TEXT PRIMARY KEY NOT NULL,
  harness TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  theme_id TEXT,
  state TEXT NOT NULL,
  expected_version TEXT NOT NULL,
  installed_version TEXT,
  target_path TEXT NOT NULL,
  managed INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
