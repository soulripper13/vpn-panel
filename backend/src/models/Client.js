/**
 * models/Client.js
 * Data-access methods for the `clients` table.
 */

'use strict';

const crypto = require('crypto');
const db = require('../config/database');

class Client {
  // ─── Token Helpers ──────────────────────────────────────────────────────────

  /**
   * Generate a cryptographically secure 256-bit subscription token and its SHA-256 hash.
   * @returns {{ rawToken: string, hash: string }}
   */
  static generateSubToken() {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, hash };
  }

  // ─── Finders ────────────────────────────────────────────────────────────────

  static findById(id) {
    return db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id);
  }

  static findByInbound(inboundId) {
    return db.prepare(`SELECT * FROM clients WHERE inbound_id = ? ORDER BY id`).all(inboundId);
  }

  static findByEmail(email) {
    return db.prepare(`SELECT * FROM clients WHERE email = ?`).get(email);
  }

  static findByUuid(uuid) {
    return db.prepare(`SELECT * FROM clients WHERE uuid = ?`).get(uuid);
  }

  static findAllByEmail(email) {
    return db.prepare(`SELECT * FROM clients WHERE email = ? ORDER BY id`).all(email);
  }

  static findAllByUuid(uuid) {
    return db.prepare(`SELECT * FROM clients WHERE uuid = ? ORDER BY id`).all(uuid);
  }

  /**
   * Find clients matching a cryptographically secure random subscription token (C1).
   * Looks up by SHA-256 hash only. Rejects guessable emails, IDs, and inbound prefixes.
   * @param {string} rawToken
   * @returns {Array<object>}
   */
  static findBySubToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return [];
    const trimmed = rawToken.trim();
    // High-entropy token validation: must be at least 32 characters
    if (trimmed.length < 32 || trimmed.length > 128) return [];

    const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const client = db.prepare(`
      SELECT * FROM clients
      WHERE sub_token_hash = ? AND enable = 1 AND sub_revoked = 0
    `).get(hash);

    if (!client) return [];

    // If client has a customized non-default email, include their other active client records under that email
    if (client.email && !client.email.startsWith('default_') && !client.email.startsWith('client_') && !client.email.startsWith('user_')) {
      const byEmail = db.prepare(`
        SELECT * FROM clients
        WHERE email = ? AND enable = 1 AND sub_revoked = 0
        ORDER BY id
      `).all(client.email);
      if (byEmail && byEmail.length > 0) return byEmail;
    }

    return [client];
  }

  /**
   * Legacy method redirected strictly to secure token lookup (C1).
   * @deprecated Use findBySubToken instead.
   */
  static findByToken(token) {
    return Client.findBySubToken(token);
  }

  static findAll() {
    return db.prepare(`SELECT * FROM clients ORDER BY id`).all();
  }

  static findEnabled() {
    return db.prepare(`SELECT * FROM clients WHERE enable = 1 ORDER BY id`).all();
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Create a new client record with a secure 256-bit subscription token.
   * @param {object} data
   * @returns {{ id: number, rawSubToken: string }}
   */
  static create(data) {
    const { rawToken, hash } = Client.generateSubToken();
    const now = Math.floor(Date.now() / 1000);
    const coerced = Client._coerce(data);

    const info = db.prepare(`
      INSERT INTO clients
        (inbound_id, uuid, password, email, flow, total_bytes_limit,
         up_bytes, down_bytes, expiry_time, enable, remark, sub_token_hash, sub_token_created_at, sub_revoked)
      VALUES
        (@inbound_id, @uuid, @password, @email, @flow, @total_bytes_limit,
         @up_bytes, @down_bytes, @expiry_time, @enable, @remark, @sub_token_hash, @sub_token_created_at, @sub_revoked)
    `).run({
      ...coerced,
      sub_token_hash: hash,
      sub_token_created_at: now,
      sub_revoked: 0,
    });

    return { id: info.lastInsertRowid, rawSubToken: rawToken };
  }

  static update(id, data) {
    const existing = Client.findById(id);
    if (!existing) throw new Error(`Client ${id} not found`);

    const merged = { ...existing, ...data };
    db.prepare(`
      UPDATE clients SET
        uuid              = @uuid,
        password          = @password,
        email             = @email,
        flow              = @flow,
        total_bytes_limit = @total_bytes_limit,
        expiry_time       = @expiry_time,
        enable            = @enable,
        remark            = @remark
      WHERE id = ?
    `).run({ ...Client._coerce(merged), id });
  }

  static rotateSubToken(id) {
    const existing = Client.findById(id);
    if (!existing) throw new Error(`Client ${id} not found`);

    const { rawToken, hash } = Client.generateSubToken();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE clients SET
        sub_token_hash = ?,
        sub_token_created_at = ?,
        sub_revoked = 0
      WHERE id = ?
    `).run(hash, now, id);

    return rawToken;
  }

  static revokeSubToken(id) {
    const existing = Client.findById(id);
    if (!existing) throw new Error(`Client ${id} not found`);

    db.prepare(`UPDATE clients SET sub_revoked = 1 WHERE id = ?`).run(id);
  }

  static delete(id) {
    db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
  }

  // ─── Data Sanitization / Redaction (H1) ──────────────────────────────────────

  /**
   * Redact client secrets for standard list APIs.
   * @param {object} client
   * @param {boolean} [reveal=false]
   * @returns {object}
   */
  static toSafeObject(client, reveal = false) {
    if (!client) return null;
    const { sub_token_hash, ...rest } = client;

    if (reveal) {
      return {
        ...rest,
        hasSubToken: Boolean(sub_token_hash && !client.sub_revoked),
      };
    }

    return {
      ...rest,
      password: client.password ? '••••••••' : '',
      uuid: client.uuid ? `${client.uuid.slice(0, 8)}••••••••` : '',
      hasSubToken: Boolean(sub_token_hash && !client.sub_revoked),
    };
  }

  // ─── Traffic ────────────────────────────────────────────────────────────────

  static addTraffic(id, up = 0, down = 0) {
    db.prepare(`
      UPDATE clients SET
        up_bytes   = up_bytes   + ?,
        down_bytes = down_bytes + ?
      WHERE id = ?
    `).run(up, down, id);
  }

  static updateTraffic(id, { up_bytes = 0, down_bytes = 0 }) {
    Client.addTraffic(id, up_bytes, down_bytes);
  }

  static resetTraffic(id) {
    db.prepare(`UPDATE clients SET up_bytes = 0, down_bytes = 0 WHERE id = ?`).run(id);
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  static _coerce(data) {
    return {
      inbound_id:        data.inbound_id        || 0,
      uuid:              data.uuid              || '',
      password:          data.password          || '',
      email:             data.email             || '',
      flow:              data.flow              || '',
      total_bytes_limit: data.total_bytes_limit || 0,
      up_bytes:          data.up_bytes          || 0,
      down_bytes:        data.down_bytes        || 0,
      expiry_time:       data.expiry_time       || 0,
      enable:            data.enable !== false  ? 1 : 0,
      remark:            data.remark            || '',
    };
  }
}

module.exports = Client;
