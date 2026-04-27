ALTER TABLE videos ADD COLUMN transcript_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_videos_transcript_hash ON videos(transcript_hash);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (3);
