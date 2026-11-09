/**
 * models/Settings.js
 * Convenience wrapper for the `settings` key/value table.
 */

'use strict';

const db = require('../config/database');

// Only panel configuration is returned to API callers. Internal settings such
// as the session signing secret must never be included in generic settings data.
const PUBLIC_SETTING_KEYS = new Set([
  'panel_port',
  'web_base_path',
  'server_ip',
  'cert_fullchain',
  'cert_privkey',
  'singbox_bin',
  'singbox_config',
  'xray_bin',
  'xray_config',
  'xray_api_port',
  'traffic_reset_day',
  'panel_ssl',
]);

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
   * Return public panel settings as a plain object; internal secrets are excluded.
   * @returns {Record<string, string>}
   */
  static getAll() {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    return Object.fromEntries(
      rows.filter((r) => PUBLIC_SETTING_KEYS.has(r.key)).map((r) => [r.key, r.value]),
    );
  }

  /**
   * Normalize a web base path:
   * '' or '/' -> ''
   * 'secret' or '/secret/' -> '/secret'
   * @param {string} [p]
   * @returns {string}
   */
  static normalizeBasePath(p) {
    if (!p || typeof p !== 'string') return '';
    let s = p.trim();
    if (s === '' || s === '/') return '';
    if (!s.startsWith('/')) s = '/' + s;
    while (s.endsWith('/') && s.length > 1) s = s.slice(0, -1);
    return s;
  }
}

module.exports = Settings;
