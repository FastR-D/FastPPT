ALTER TABLE image_assets ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate';

UPDATE image_assets SET status = 'accepted' WHERE accepted = 1;
