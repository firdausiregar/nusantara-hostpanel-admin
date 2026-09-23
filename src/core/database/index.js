'use strict';

const fs = require('node:fs');
const Database = require('better-sqlite3');
const config = require('../config');
const { migrations } = require('./migrations');

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o750 });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

for (const migration of migrations) {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(migration.id)) continue;
  db.transaction(() => {
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
  })();
}

// Low-cost retention cleanup. Operations are deliberately bounded and indexed.
try { db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now','-180 days')").run(); } catch {}
try { db.prepare("DELETE FROM security_events WHERE created_at < datetime('now','-180 days')").run(); } catch {}
try { db.prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < datetime('now','-90 days')").run(); } catch {}

module.exports = db;
