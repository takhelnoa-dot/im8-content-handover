-- videos
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  drive_file_id TEXT UNIQUE,
  drive_url TEXT,
  title TEXT,
  duration_seconds REAL,
  thumbnail_path TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT,
  status TEXT DEFAULT 'queued',
  error_message TEXT,
  raw_whisper_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_added_at ON videos(added_at);

-- speakers
CREATE TABLE IF NOT EXISTS speakers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT UNIQUE,
  notes TEXT,
  is_unknown INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- segments
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  speaker_id TEXT REFERENCES speakers(id),
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_video ON segments(video_id);
CREATE INDEX IF NOT EXISTS idx_segments_speaker ON segments(speaker_id);

-- FTS5 virtual table mirrors segments.text
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  text,
  content='segments',
  content_rowid='id',
  tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;

-- sqlite-vec virtual table (1536-dim for text-embedding-3-small)
CREATE VIRTUAL TABLE IF NOT EXISTS segments_vec USING vec0(
  segment_id INTEGER PRIMARY KEY,
  embedding FLOAT[1536]
);

-- video_speakers
CREATE TABLE IF NOT EXISTS video_speakers (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  speaker_id TEXT NOT NULL REFERENCES speakers(id),
  segment_count INTEGER DEFAULT 0,
  PRIMARY KEY (video_id, speaker_id)
);

-- categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_categories_status ON categories(status);

-- rejected categories (30-day cooldown)
CREATE TABLE IF NOT EXISTS rejected_categories (
  name TEXT PRIMARY KEY,
  rejected_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- video_categories
CREATE TABLE IF NOT EXISTS video_categories (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 0.5,
  PRIMARY KEY (video_id, category_id)
);

-- users (simple auth)
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- saved searches
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  username TEXT,
  name TEXT NOT NULL,
  query TEXT,
  filters_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- schema version
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
