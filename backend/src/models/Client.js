/**
 * models/Client.js
 * Data-access methods for the `clients` table.
 */

'use strict';

const db = require('../config/database');

class Client {
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
   * Find clients matching a subscription token (UUID, email, ID, or inbound prefix)
   * @param {string} token
   * @returns {Array<object>}
   */
  static findByToken(token) {
    if (!token) return [];

    // Check for inbound prefix: "inbound-1", "inbound:1", "inbound_1"
    const inbMatch = String(token).match(/^inbound[:_-]?(\d+)$/i);
    if (inbMatch) {
      const inbId = parseInt(inbMatch[1], 10);
      return Client.findByInbound(inbId);
    }

    // Match UUID
    const byUuid = db.prepare(`SELECT * FROM clients WHERE uuid = ?`).all(token);
    if (byUuid && byUuid.length > 0) {
      const primary = byUuid[0];
      // If client has a customized non-default email, include all client records under that email
      if (primary.email && !primary.email.startsWith('default_') && !primary.email.startsWith('client_') && !primary.email.startsWith('user_')) {
        const byEmail = db.prepare(`SELECT * FROM clients WHERE email = ? ORDER BY id`).all(primary.email);
        if (byEmail && byEmail.length > 1) return byEmail;
      }
      return byUuid;
    }

    // Match Email
    const byEmail = db.prepare(`SELECT * FROM clients WHERE email = ? ORDER BY id`).all(token);
    if (byEmail && byEmail.length > 0) {
      return byEmail;
    }

    // Match numeric client ID
    if (/^\d+$/.test(String(token))) {
      const byId = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(parseInt(token, 10));
      if (byId) return [byId];
    }

    return [];
  }

  static findAll() {
    return db.prepare(`SELECT * FROM clients ORDER BY id`).all();
  }

  static findEnabled() {
    return db.prepare(`SELECT * FROM clients WHERE enable = 1 ORDER BY id`).all();
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Create a new client record.
   * @param {object} data
   * @returns {{ id: number }}
   */
  static create(data) {
    const info = db.prepare(`
      INSERT INTO clients
        (inbound_id, uuid, password, email, flow, total_bytes_limit,
         expiry_time, enable, remark)
      VALUES
        (@inbound_id, @uuid, @password, @email, @flow, @total_bytes_limit,
         @expiry_time, @enable, @remark)
    `).run(Client._coerce(data));
    return { id: info.lastInsertRowid };
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

  static delete(id) {
    db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
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
      expiry_time:       data.expiry_time       || 0,
      enable:            data.enable !== false  ? 1 : 0,
      remark:            data.remark            || '',
    };
  }
}

module.exports = Client;
