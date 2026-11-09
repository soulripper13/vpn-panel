/**
 * utils/audit.js
 * Audit logging helper for recording security and admin events (M4).
 */

'use strict';

const db = require('../config/database');

function logAudit({ userId = null, username = 'system', ip = '127.0.0.1', action, target = '', details = '', status = 'success' }) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (user_id, username, ip, action, target, details, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userId, username, ip, action, target, typeof details === 'object' ? JSON.stringify(details) : String(details), status);
  } catch (err) {
    console.error('[Audit Log Error]', err.message);
  }
}

function getAuditLogs(limit = 100, offset = 0) {
  try {
    return db.prepare(`
      SELECT * FROM audit_logs
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(Math.min(limit, 500), Math.max(offset, 0));
  } catch (err) {
    console.error('[Audit Log Read Error]', err.message);
    return [];
  }
}

module.exports = {
  logAudit,
  getAuditLogs,
};
