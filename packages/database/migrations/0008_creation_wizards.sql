CREATE TABLE IF NOT EXISTS creation_wizards (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  current_step TEXT NOT NULL,
  decisions TEXT NOT NULL,
  profile_digest TEXT,
  updated_at TEXT NOT NULL
);
