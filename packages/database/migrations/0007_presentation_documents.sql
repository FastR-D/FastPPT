CREATE TABLE IF NOT EXISTS deck_documents (
  deck_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  revision TEXT NOT NULL,
  digest TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deck_id, kind)
);

CREATE TABLE IF NOT EXISTS speaker_notes (
  deck_id TEXT NOT NULL,
  slide_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  digest TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deck_id, slide_id)
);

CREATE TABLE IF NOT EXISTS animation_documents (
  deck_id TEXT NOT NULL,
  slide_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  digest TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deck_id, slide_id)
);

CREATE TABLE IF NOT EXISTS diagram_documents (
  deck_id TEXT NOT NULL,
  diagram_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  digest TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deck_id, diagram_id)
);

CREATE TABLE IF NOT EXISTS asset_provenance (
  asset_id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  prompt TEXT,
  model TEXT,
  schema_revision TEXT,
  accepted_digest TEXT,
  created_at TEXT NOT NULL
);
