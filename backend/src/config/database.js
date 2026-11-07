/**
 * database.js
 * SQLite database setup using better-sqlite3.
 * Creates all tables, seeds the default admin user, and exports the db instance.
 */

'use strict';

const Database = require('better-sqlite3');
const bcrypt   = require('bcrypt');
const path     = require('path');
const fs       = require('fs');
const cfg      = require('./app-config');

// Ensure data directory exists
const dataDir = path.dirname(cfg.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/** @type {import('better-sqlite3').Database} */
const db = new Database(cfg.DB_PATH, {
  // Verbose logging in dev mode
  verbose: cfg.IS_DEV ? (msg) => process.stdout.write(`[SQL] ${msg}\n`) : null,
});

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL UNIQUE,
    password_hash TEXT   NOT NULL,
    role         TEXT    NOT NULL DEFAULT 'admin',  -- 'admin' | 'viewer'
    created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS inbounds (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    engine               TEXT    NOT NULL,            -- 'singbox' | 'xray'
    tag                  TEXT    NOT NULL UNIQUE,      -- unique tag within engine config
    type                 TEXT    NOT NULL,             -- protocol type
    listen               TEXT    NOT NULL DEFAULT '0.0.0.0',
    port                 INTEGER NOT NULL,
    protocol             TEXT,                         -- alias / sub-protocol
    settings_json        TEXT    NOT NULL DEFAULT '{}',
    stream_settings_json TEXT    NOT NULL DEFAULT '{}',
    enabled              INTEGER NOT NULL DEFAULT 1,
    up_bytes             INTEGER NOT NULL DEFAULT 0,
    down_bytes           INTEGER NOT NULL DEFAULT 0,
    total_bytes_limit    INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
    expiry_time          INTEGER NOT NULL DEFAULT 0,   -- 0 = never, epoch seconds
    remark               TEXT    NOT NULL DEFAULT '',
    created_at           INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    inbound_id        INTEGER NOT NULL REFERENCES inbounds(id) ON DELETE CASCADE,
    uuid              TEXT    NOT NULL DEFAULT '',
    password          TEXT    NOT NULL DEFAULT '',
    email             TEXT    NOT NULL,
    flow              TEXT    NOT NULL DEFAULT '',
    total_bytes_limit INTEGER NOT NULL DEFAULT 0,
    up_bytes          INTEGER NOT NULL DEFAULT 0,
    down_bytes        INTEGER NOT NULL DEFAULT 0,
    expiry_time       INTEGER NOT NULL DEFAULT 0,
    enable            INTEGER NOT NULL DEFAULT 1,
    remark            TEXT    NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS traffic_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    inbound_id   INTEGER NOT NULL REFERENCES inbounds(id) ON DELETE CASCADE,
    client_email TEXT    NOT NULL DEFAULT '',
    up_bytes     INTEGER NOT NULL DEFAULT 0,
    down_bytes   INTEGER NOT NULL DEFAULT 0,
    logged_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_clients_inbound   ON clients(inbound_id);
  CREATE INDEX IF NOT EXISTS idx_traffic_inbound   ON traffic_logs(inbound_id);
  CREATE INDEX IF NOT EXISTS idx_traffic_email     ON traffic_logs(client_email);
  CREATE INDEX IF NOT EXISTS idx_traffic_logged_at ON traffic_logs(logged_at);
`);

// ─── Default Settings ─────────────────────────────────────────────────────────

const defaultSettings = {
  panel_port:    String(cfg.PANEL_PORT),
  cert_fullchain: cfg.CERT_FULLCHAIN,
  cert_privkey:  cfg.CERT_PRIVKEY,
  singbox_bin:   cfg.SINGBOX_BIN,
  singbox_config: cfg.SINGBOX_CONFIG,
  xray_bin:      cfg.XRAY_BIN,
  xray_config:   cfg.XRAY_CONFIG,
  xray_api_port: String(cfg.XRAY_API_PORT),
  traffic_reset_day: '1',   // day of month to reset traffic counters
};

const insertSetting = db.prepare(
  `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
);

const seedSettings = db.transaction(() => {
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value);
  }
});

seedSettings();

// ─── Default Admin User ───────────────────────────────────────────────────────

const existingAdmin = db.prepare(`SELECT id FROM users WHERE username = ?`).get(cfg.DEFAULT_ADMIN_USERNAME);

if (!existingAdmin) {
  const hash = bcrypt.hashSync(cfg.DEFAULT_ADMIN_PASSWORD, 12);
  db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`).run(
    cfg.DEFAULT_ADMIN_USERNAME,
    hash,
  );
  console.log(`[DB] Default admin user created: ${cfg.DEFAULT_ADMIN_USERNAME}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get a setting value by key.
 * @param {string} key
 * @param {string} [fallback='']
 * @returns {string}
 */
db.getSetting = function (key, fallback = '') {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : fallback;
};

/**
 * Set (upsert) a setting value.
 * @param {string} key
 * @param {string} value
 */
db.setSetting = function (key, value) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
};

module.exports = db;
