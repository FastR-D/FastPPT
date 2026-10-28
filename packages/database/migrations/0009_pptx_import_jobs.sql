CREATE TABLE IF NOT EXISTS pptx_import_jobs (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upload',
  source_hash TEXT,
  analysis_path TEXT,
  decisions TEXT NOT NULL DEFAULT '[]',
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pptx_import_jobs_theme_idx
  ON pptx_import_jobs(theme_id);
