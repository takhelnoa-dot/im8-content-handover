ALTER TABLE videos ADD COLUMN video_embedding BLOB;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (6);
