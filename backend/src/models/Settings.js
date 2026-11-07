/**
 * models/Settings.js
 * Convenience wrapper for the `settings` key/value table.
 */

'use strict';

const db = require('../config/database');

class Settings {
  /**
   * Get a single setting value.
   * @param {string} key
   * @param {string} [fallback='']
   * @returns {string}
   */
  static get(key, fallback = '') {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row ? row.value : fallback;
  }

  /**
   * Upsert a setting.
   * @param {string} key
   * @param {string|number} value
   */
  static set(key, value) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
  }

  /**
   * Bulk upsert.
   * @param {Record<string, string|number>} map
   */
  static setMany(map) {
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    const tx   = db.transaction((entries) => {
      for (const [k, v] of entries) stmt.run(k, String(v));
    });
    tx(Object.entries(map));
  }

  /**
   * Return all settings as a plain object.
   * @returns {Record<string, string>}
   */
  static getAll() {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}

module.exports = Settings;
