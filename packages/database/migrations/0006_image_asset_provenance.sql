ALTER TABLE image_assets ADD COLUMN source_url TEXT;
ALTER TABLE image_assets ADD COLUMN license TEXT;
ALTER TABLE image_assets ADD COLUMN attribution TEXT;

CREATE INDEX IF NOT EXISTS image_assets_source_url_idx
  ON image_assets(source_url);
