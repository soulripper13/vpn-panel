/**
 * models/Inbound.js
 * Data-access methods for the `inbounds` table.
 */

'use strict';

const db = require('../config/database');

class Inbound {
  // ─── Finders ────────────────────────────────────────────────────────────────

  static findById(id) {
    const row = db.prepare(`SELECT * FROM inbounds WHERE id = ?`).get(id);
    return row ? Inbound._parse(row) : null;
  }

  static findByTag(tag) {
    const row = db.prepare(`SELECT * FROM inbounds WHERE tag = ?`).get(tag);
    return row ? Inbound._parse(row) : null;
  }

  static findAll({ engine } = {}) {
    let query = `SELECT * FROM inbounds`;
    const params = [];
    if (engine) {
      query += ` WHERE engine = ?`;
      params.push(engine);
    }
    query += ` ORDER BY id`;
    return db.prepare(query).all(...params).map(Inbound._parse);
  }

  static findEnabled({ engine } = {}) {
    let query = `SELECT * FROM inbounds WHERE enabled = 1`;
    const params = [];
    if (engine) {
      query += ` AND engine = ?`;
      params.push(engine);
    }
    return db.prepare(query).all(...params).map(Inbound._parse);
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Create a new inbound record.
   * @param {object} data
   * @returns {{ id: number }}
   */
  static create(data) {
    const info = db.prepare(`
      INSERT INTO inbounds
        (engine, tag, type, listen, port, protocol, settings_json, stream_settings_json,
         enabled, total_bytes_limit, expiry_time, remark)
      VALUES
        (@engine, @tag, @type, @listen, @port, @protocol, @settings_json, @stream_settings_json,
         @enabled, @total_bytes_limit, @expiry_time, @remark)
    `).run(Inbound._serialize(data));
    return { id: info.lastInsertRowid };
  }

  /**
   * Update an existing inbound.
   * @param {number} id
   * @param {object} data  Partial or full inbound fields.
   */
  static update(id, data) {
    const existing = Inbound.findById(id);
    if (!existing) throw new Error(`Inbound ${id} not found`);

    const merged = { ...existing, ...data };
    db.prepare(`
      UPDATE inbounds SET
        engine               = @engine,
        tag                  = @tag,
        type                 = @type,
        listen               = @listen,
        port                 = @port,
        protocol             = @protocol,
        settings_json        = @settings_json,
        stream_settings_json = @stream_settings_json,
        enabled              = @enabled,
        total_bytes_limit    = @total_bytes_limit,
        expiry_time          = @expiry_time,
        remark               = @remark
      WHERE id = ?
    `).run({ ...Inbound._serialize(merged), id });
  }

  static toggle(id) {
    const row = db.prepare(`SELECT enabled FROM inbounds WHERE id = ?`).get(id);
    if (!row) throw new Error(`Inbound ${id} not found`);
    db.prepare(`UPDATE inbounds SET enabled = ? WHERE id = ?`).run(row.enabled ? 0 : 1, id);
    return !row.enabled;
  }

  static delete(id) {
    db.prepare(`DELETE FROM inbounds WHERE id = ?`).run(id);
  }

  // ─── Traffic ────────────────────────────────────────────────────────────────

  static addTraffic(id, up = 0, down = 0) {
    db.prepare(`
      UPDATE inbounds SET
        up_bytes   = up_bytes   + ?,
        down_bytes = down_bytes + ?
      WHERE id = ?
    `).run(up, down, id);
  }

  static updateTraffic(id, { up_bytes = 0, down_bytes = 0 }) {
    Inbound.addTraffic(id, up_bytes, down_bytes);
  }

  static resetTraffic(id) {
    db.prepare(`UPDATE inbounds SET up_bytes = 0, down_bytes = 0 WHERE id = ?`).run(id);
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  /** Parse JSON fields from a raw DB row. */
  static _parse(row) {
    return {
      ...row,
      settings:        JSON.parse(row.settings_json        || '{}'),
      stream_settings: JSON.parse(row.stream_settings_json || '{}'),
      enabled:         Boolean(row.enabled),
    };
  }

  /** Serialize object fields to JSON strings ready for DB insert/update. */
  static _serialize(data) {
    return {
      engine:               data.engine               || 'singbox',
      tag:                  data.tag                  || '',
      type:                 data.type                 || '',
      listen:               data.listen               || '0.0.0.0',
      port:                 data.port                 || 0,
      protocol:             data.protocol             || '',
      settings_json:        JSON.stringify(data.settings        || data.settings_json        || {}),
      stream_settings_json: JSON.stringify(data.stream_settings || data.stream_settings_json || {}),
      enabled:              data.enabled !== false ? 1 : 0,
      total_bytes_limit:    data.total_bytes_limit    || 0,
      expiry_time:          data.expiry_time          || 0,
      remark:               data.remark               || '',
    };
  }
}

module.exports = Inbound;
