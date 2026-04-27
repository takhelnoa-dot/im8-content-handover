ALTER TABLE videos ADD COLUMN speaker_hint TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (4);
