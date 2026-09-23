'use strict';

const session = require('express-session');
const db = require('../database');

// Lightweight production session store backed by the same better-sqlite3
// connection as the control-plane database. This avoids loading a second
// native SQLite driver solely for sessions.
db.exec(`
  CREATE TABLE IF NOT EXISTS http_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_http_sessions_expires
    ON http_sessions(expires_at);
`);

const getStmt = db.prepare('SELECT sess, expires_at FROM http_sessions WHERE sid=?');
const setStmt = db.prepare(`
  INSERT INTO http_sessions (sid, sess, expires_at, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET
    sess=excluded.sess,
    expires_at=excluded.expires_at,
    updated_at=excluded.updated_at
`);
const destroyStmt = db.prepare('DELETE FROM http_sessions WHERE sid=?');
const clearStmt = db.prepare('DELETE FROM http_sessions');
const countStmt = db.prepare('SELECT COUNT(*) AS count FROM http_sessions WHERE expires_at>?');
const pruneStmt = db.prepare('DELETE FROM http_sessions WHERE expires_at<=?');

function expiryFromSession(sess) {
  const cookie = sess && sess.cookie ? sess.cookie : {};
  if (cookie.expires) {
    const value = new Date(cookie.expires).getTime();
    if (Number.isFinite(value)) return value;
  }
  const maxAge = Number(cookie.originalMaxAge ?? cookie.maxAge ?? 8 * 60 * 60 * 1000);
  return Date.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 8 * 60 * 60 * 1000);
}

class BetterSqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.pruneIntervalMs = Math.max(60_000, Number(options.pruneIntervalMs || 15 * 60_000));
    this._lastPrune = 0;
  }

  _pruneIfDue() {
    const now = Date.now();
    if (now - this._lastPrune < this.pruneIntervalMs) return;
    this._lastPrune = now;
    pruneStmt.run(now);
  }

  get(sid, callback) {
    try {
      this._pruneIfDue();
      const row = getStmt.get(String(sid));
      if (!row) return callback(null, null);
      if (Number(row.expires_at) <= Date.now()) {
        destroyStmt.run(String(sid));
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const now = Date.now();
      setStmt.run(String(sid), JSON.stringify(sess), expiryFromSession(sess), now);
      this._pruneIfDue();
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    this.set(sid, sess, callback);
  }

  destroy(sid, callback = () => {}) {
    try {
      destroyStmt.run(String(sid));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  clear(callback = () => {}) {
    try {
      clearStmt.run();
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  length(callback) {
    try {
      this._pruneIfDue();
      callback(null, Number(countStmt.get(Date.now()).count || 0));
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = BetterSqliteSessionStore;
