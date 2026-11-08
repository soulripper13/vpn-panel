/**
 * app-config.js
 * Central configuration constants for the VPN panel.
 * All runtime-tunable values should live here or in the DB `settings` table.
 */

'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

// Try to load .env from panel root or backend root
try {
  require('dotenv').config({ path: '/opt/vpn-panel/.env' });
} catch {}
try {
  require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
} catch {}
try {
  require('dotenv').config();
} catch {}

// ─── Panel ────────────────────────────────────────────────────────────────────
const PANEL_PORT    = parseInt(process.env.PANEL_PORT || '2096', 10);
const crypto        = require('crypto');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// ─── Sing-box ─────────────────────────────────────────────────────────────────
function detectSingboxBin() {
  if (process.env.SINGBOX_BIN) return process.env.SINGBOX_BIN;
  if (fs.existsSync('/usr/bin/sing-box')) return '/usr/bin/sing-box';
  if (fs.existsSync('/usr/local/bin/sing-box')) return '/usr/local/bin/sing-box';
  return '/usr/bin/sing-box';
}
const SINGBOX_BIN        = detectSingboxBin();
const SINGBOX_CONFIG     = process.env.SINGBOX_CONFIG     || '/etc/sing-box/config.json';
const SINGBOX_SERVICE    = process.env.SINGBOX_SERVICE    || 'sing-box';   // systemd unit name
const SINGBOX_LOG_LINES  = parseInt(process.env.SINGBOX_LOG_LINES || '200', 10);

// ─── Xray ─────────────────────────────────────────────────────────────────────
function detectXrayBin() {
  if (process.env.XRAY_BIN) return process.env.XRAY_BIN;
  if (fs.existsSync('/usr/local/bin/xray')) return '/usr/local/bin/xray';
  if (fs.existsSync('/usr/local/x-ui/bin/xray-linux-amd64')) return '/usr/local/x-ui/bin/xray-linux-amd64';
  if (fs.existsSync('/usr/bin/xray')) return '/usr/bin/xray';
  return '/usr/local/bin/xray';
}
function detectXrayConfig() {
  if (process.env.XRAY_CONFIG) return process.env.XRAY_CONFIG;
  if (fs.existsSync('/usr/local/x-ui/bin/config.json')) return '/usr/local/x-ui/bin/config.json';
  if (fs.existsSync('/etc/xray/config.json')) return '/etc/xray/config.json';
  return '/usr/local/x-ui/bin/config.json';
}
const XRAY_BIN        = detectXrayBin();
const XRAY_CONFIG     = detectXrayConfig();
const XRAY_SERVICE    = process.env.XRAY_SERVICE    || 'xray';            // systemd unit name
const XRAY_API_PORT   = parseInt(process.env.XRAY_API_PORT || '62789', 10);
const XRAY_LOG_LINES  = parseInt(process.env.XRAY_LOG_LINES || '200', 10);
// Xray process name used when searching /proc or ps
const XRAY_PROCESS_NAME = 'xray';

// ─── TLS certificates (detect existing certificate if available) ─────────────
function detectCert(type) {
  if (type === 'fullchain') {
    if (process.env.CERT_FULLCHAIN) return process.env.CERT_FULLCHAIN;
    if (fs.existsSync('/root/cert/ip/fullchain.pem')) return '/root/cert/ip/fullchain.pem';
    if (fs.existsSync('/etc/ssl/certs/ssl-cert-snakeoil.pem')) return '/etc/ssl/certs/ssl-cert-snakeoil.pem';
    return '';
  }
  if (type === 'privkey') {
    if (process.env.CERT_PRIVKEY) return process.env.CERT_PRIVKEY;
    if (fs.existsSync('/root/cert/ip/privkey.pem')) return '/root/cert/ip/privkey.pem';
    if (fs.existsSync('/etc/ssl/private/ssl-cert-snakeoil.key')) return '/etc/ssl/private/ssl-cert-snakeoil.key';
    return '';
  }
  return '';
}

const CERT_FULLCHAIN = detectCert('fullchain');
const CERT_PRIVKEY   = detectCert('privkey');

// ─── Database ─────────────────────────────────────────────────────────────────
const defaultDbPath = fs.existsSync('/opt/vpn-panel/data/panel.db')
  ? '/opt/vpn-panel/data/panel.db'
  : path.join(__dirname, '../../data/panel.db');
const DB_PATH = process.env.DB_PATH || defaultDbPath;

// ─── Default credentials ──────────────────────────────────────────────────────
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123';  // plain; will be bcrypt-hashed on first run

// ─── WebSocket ────────────────────────────────────────────────────────────────
const WS_PUSH_INTERVAL_MS = parseInt(process.env.WS_PUSH_INTERVAL_MS || '2000', 10);

// ─── Traffic polling ──────────────────────────────────────────────────────────
const TRAFFIC_POLL_INTERVAL_MS = parseInt(process.env.TRAFFIC_POLL_INTERVAL_MS || '10000', 10);

// ─── Rate limiting ────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS  = 15 * 60 * 1000;  // 15 minutes
const RATE_LIMIT_MAX         = 200;              // requests per window per IP
const LOGIN_RATE_LIMIT_MAX   = 10;              // stricter for auth endpoints

// ─── Misc ─────────────────────────────────────────────────────────────────────
const NODE_ENV  = process.env.NODE_ENV || 'production';
const IS_DEV    = NODE_ENV === 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_DEV ? 'debug' : 'info');

module.exports = {
  // Panel
  PANEL_PORT,
  SESSION_SECRET,

  // Sing-box
  SINGBOX_BIN,
  SINGBOX_CONFIG,
  SINGBOX_SERVICE,
  SINGBOX_LOG_LINES,

  // Xray
  XRAY_BIN,
  XRAY_CONFIG,
  XRAY_SERVICE,
  XRAY_API_PORT,
  XRAY_LOG_LINES,
  XRAY_PROCESS_NAME,

  // TLS
  CERT_FULLCHAIN,
  CERT_PRIVKEY,

  // Database
  DB_PATH,

  // Auth
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ADMIN_PASSWORD,

  // WebSocket
  WS_PUSH_INTERVAL_MS,

  // Traffic
  TRAFFIC_POLL_INTERVAL_MS,

  // Rate limiting
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_MAX,

  // Env
  NODE_ENV,
  IS_DEV,
  LOG_LEVEL,
};
