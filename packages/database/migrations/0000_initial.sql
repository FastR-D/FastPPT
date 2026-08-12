CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  root TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  harness TEXT NOT NULL,
  session_id TEXT NOT NULL,
  theme_id TEXT,
  theme_skill_id TEXT,
  theme_skill_version TEXT,
  registry_version TEXT NOT NULL,
  status TEXT NOT NULL,
  invocation_status TEXT NOT NULL,
  invocation_mechanism TEXT,
  observation_evidence TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);

CREATE TABLE IF NOT EXISTS exports (
  export_id TEXT PRIMARY KEY NOT NULL,
  deck_id TEXT NOT NULL,
  status TEXT NOT NULL,
  output_name TEXT NOT NULL,
  output_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
