CREATE TABLE IF NOT EXISTS image_runs (
  image_run_id TEXT PRIMARY KEY NOT NULL,
  deck_id TEXT NOT NULL,
  deck_revision TEXT NOT NULL,
  slide_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS image_runs_deck_id_idx
  ON image_runs(deck_id, created_at DESC);

CREATE TABLE IF NOT EXISTS image_assets (
  image_asset_id TEXT PRIMARY KEY NOT NULL,
  deck_id TEXT NOT NULL,
  image_run_id TEXT REFERENCES image_runs(image_run_id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  source TEXT NOT NULL,
  accepted INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(deck_id, path),
  UNIQUE(deck_id, sha256)
);

CREATE INDEX IF NOT EXISTS image_assets_deck_id_idx
  ON image_assets(deck_id, created_at DESC);
