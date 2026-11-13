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

// Ensure data directory exists with restricted permissions (0700)
const dataDir = path.dirname(cfg.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
} else {
  try { fs.chmodSync(dataDir, 0o700); } catch {}
}

/** @type {import('better-sqlite3').Database} */
const db = new Database(cfg.DB_PATH, {
  // Verbose logging in dev mode
  verbose: cfg.IS_DEV ? (msg) => process.stdout.write(`[SQL] ${msg}\n`) : null,
});

// Secure DB file permissions (0600)
try {
  if (fs.existsSync(cfg.DB_PATH)) {
    fs.chmodSync(cfg.DB_PATH, 0o600);
  }
} catch {}

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
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    inbound_id           INTEGER NOT NULL REFERENCES inbounds(id) ON DELETE CASCADE,
    uuid                 TEXT    NOT NULL DEFAULT '',
    password             TEXT    NOT NULL DEFAULT '',
    email                TEXT    NOT NULL,
    flow                 TEXT    NOT NULL DEFAULT '',
    total_bytes_limit    INTEGER NOT NULL DEFAULT 0,
    up_bytes             INTEGER NOT NULL DEFAULT 0,
    down_bytes           INTEGER NOT NULL DEFAULT 0,
    expiry_time          INTEGER NOT NULL DEFAULT 0,
    enable               INTEGER NOT NULL DEFAULT 1,
    remark               TEXT    NOT NULL DEFAULT '',
    sub_token_hash       TEXT    DEFAULT NULL,
    sub_token_created_at INTEGER NOT NULL DEFAULT 0,
    sub_revoked          INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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

  -- Persistent SQLite sessions table
  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    sess       TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );

  -- Append-only audit logs table
  CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    username   TEXT NOT NULL,
    ip         TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT NOT NULL,
    details    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'success',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Saved SNI library for anti-censorship camouflage
  CREATE TABLE IF NOT EXISTS saved_snis (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    domain       TEXT    NOT NULL UNIQUE,
    port         INTEGER NOT NULL DEFAULT 443,
    score        INTEGER NOT NULL DEFAULT 0,
    rating       TEXT    NOT NULL DEFAULT 'IDEAL',
    tls_protocol TEXT    NOT NULL DEFAULT '',
    alpn         TEXT    NOT NULL DEFAULT '',
    matches_san  INTEGER NOT NULL DEFAULT 1,
    latency_ms   INTEGER NOT NULL DEFAULT 0,
    source       TEXT    NOT NULL DEFAULT 'web_scourer',
    region       TEXT    NOT NULL DEFAULT 'GLOBAL',
    notes        TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_clients_inbound   ON clients(inbound_id);
  CREATE INDEX IF NOT EXISTS idx_traffic_inbound   ON traffic_logs(inbound_id);
  CREATE INDEX IF NOT EXISTS idx_traffic_email     ON traffic_logs(client_email);
  CREATE INDEX IF NOT EXISTS idx_traffic_logged_at ON traffic_logs(logged_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_expired  ON sessions(expired_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created     ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_saved_snis_score  ON saved_snis(score DESC);
`);

// ─── Migrations for existing databases ────────────────────────────────────────

try {
  const clientCols = db.prepare("PRAGMA table_info(clients)").all().map((c) => c.name);
  if (!clientCols.includes('sub_token_hash')) {
    db.exec("ALTER TABLE clients ADD COLUMN sub_token_hash TEXT DEFAULT NULL");
  }
  if (!clientCols.includes('sub_token_created_at')) {
    db.exec("ALTER TABLE clients ADD COLUMN sub_token_created_at INTEGER DEFAULT 0");
  }
  if (!clientCols.includes('sub_revoked')) {
    db.exec("ALTER TABLE clients ADD COLUMN sub_revoked INTEGER DEFAULT 0");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_clients_sub_hash ON clients(sub_token_hash)");
} catch (err) {
  console.error('[DB Migration] Client schema migration failed:', err.message);
  throw err;
}

// Ensure all clients have high-entropy sub_token_hash
try {
  const crypto = require('crypto');
  const missingTokens = db.prepare("SELECT id FROM clients WHERE sub_token_hash IS NULL").all();
  if (missingTokens.length > 0) {
    const updateStmt = db.prepare("UPDATE clients SET sub_token_hash = ?, sub_token_created_at = ? WHERE id = ?");
    const now = Math.floor(Date.now() / 1000);
    const migrateTx = db.transaction(() => {
      for (const row of missingTokens) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        updateStmt.run(hash, now, row.id);
      }
    });
    migrateTx();
    console.log(`[DB Migration] Generated secure subscription token hashes for ${missingTokens.length} client(s).`);
  }
} catch (err) {
  console.warn('[DB Migration] Sub token migration notice:', err.message);
}

// ─── Default Settings ─────────────────────────────────────────────────────────

const defaultSettings = {
  panel_port:    String(cfg.PANEL_PORT),
  web_base_path: cfg.WEB_BASE_PATH || '/',
  server_ip:     cfg.SERVER_IP || '',
  cert_fullchain: cfg.CERT_FULLCHAIN || '',
  cert_privkey:  cfg.CERT_PRIVKEY || '',
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

// Ensure persistent session secret exists in database if not provided in environment
try {
  const existingSecret = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get();
  if (!existingSecret || !existingSecret.value) {
    const crypto = require('crypto');
    const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('session_secret', ?)").run(secret);
  }
} catch (err) {
  console.warn('[DB Settings] Notice on session_secret setup:', err.message);
}

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
