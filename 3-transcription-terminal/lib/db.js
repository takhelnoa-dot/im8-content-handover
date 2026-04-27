const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let dbInstance;

function getDb() {
  if (dbInstance) return dbInstance;

  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  sqliteVec.load(db);

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  // Bootstrap: ensure schema_migrations exists so we can check applied versions.
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);');
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map(r => r.version));

  for (const f of files) {
    const m = f.match(/^(\d+)_/);
    const version = m ? parseInt(m[1], 10) : null;
    // If file declares a version and it's already applied AND the file contains
    // non-idempotent statements (ALTER, etc), skip it. CREATE/INSERT-OR-IGNORE
    // SQL is safe to re-run, so for migrations 001 (initial idempotent) and 002
    // (seed taxonomy with INSERT OR IGNORE) we can re-run. For 003+ that may
    // contain ALTER TABLE, skipping is required.
    if (version != null && version >= 3 && applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    db.exec(sql);
  }

  dbInstance = db;
  return db;
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { getDb, closeDb };
