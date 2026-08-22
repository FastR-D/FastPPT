CREATE TABLE IF NOT EXISTS session_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  harness TEXT NOT NULL,
  session_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  profile_digest TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  theme_skill_id TEXT,
  theme_skill_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(harness, session_id)
);

ALTER TABLE runs ADD COLUMN session_profile TEXT;
ALTER TABLE runs ADD COLUMN profile_digest TEXT;

CREATE TABLE IF NOT EXISTS quality_reports (
  deck_id TEXT PRIMARY KEY NOT NULL,
  revision TEXT NOT NULL,
  report TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
