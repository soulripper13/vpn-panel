/**
 * utils/session-store.js
 * Persistent SQLite session store for express-session using better-sqlite3.
 * Eliminates the MemoryStore warning and persists logins across server restarts.
 */

'use strict';

const session = require('express-session');
const db = require('../config/database');

class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.db = options.db || db;

    // Periodic cleanup of expired sessions every 15 minutes
    this.cleanupInterval = setInterval(() => {
      this.clearExpired();
    }, 15 * 60 * 1000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  get(sid, callback) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?').get(sid, now);
      if (!row) {
        return callback(null, null);
      }
      const sess = JSON.parse(row.sess);
      return callback(null, sess);
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      let maxAge = 7 * 24 * 60 * 60; // default 7 days in seconds
      if (sess.cookie && sess.cookie.maxAge) {
        maxAge = Math.floor(sess.cookie.maxAge / 1000);
      }
      const expiredAt = Math.floor(Date.now() / 1000) + maxAge;
      const sessStr = JSON.stringify(sess);

      this.db.prepare(`
        INSERT OR REPLACE INTO sessions (sid, sess, expired_at)
        VALUES (?, ?, ?)
      `).run(sid, sessStr, expiredAt);

      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      let maxAge = 7 * 24 * 60 * 60;
      if (sess.cookie && sess.cookie.maxAge) {
        maxAge = Math.floor(sess.cookie.maxAge / 1000);
      }
      const expiredAt = Math.floor(Date.now() / 1000) + maxAge;
      this.db.prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?').run(expiredAt, sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  clearExpired() {
    try {
      const now = Math.floor(Date.now() / 1000);
      this.db.prepare('DELETE FROM sessions WHERE expired_at <= ?').run(now);
    } catch {}
  }

  destroyAllForUser(userId) {
    try {
      const rows = this.db.prepare('SELECT sid, sess FROM sessions').all();
      const deleteStmt = this.db.prepare('DELETE FROM sessions WHERE sid = ?');
      for (const row of rows) {
        try {
          const sess = JSON.parse(row.sess);
          if (sess.user && sess.user.id === userId) {
            deleteStmt.run(row.sid);
          }
        } catch {}
      }
    } catch {}
  }
}

const defaultStore = new SqliteSessionStore();

module.exports = SqliteSessionStore;
module.exports.defaultStore = defaultStore;

