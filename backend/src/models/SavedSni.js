/**
 * models/SavedSni.js
 * Model for storing user-saved and bookmarked SNI camouflage domains.
 */

'use strict';

const db = require('../config/database');

class SavedSni {
  /**
   * Get all saved SNIs, optionally filtered by region, ordered by score descending
   */
  static getAll(region = null) {
    if (region && region !== 'ALL' && region !== 'AUTO') {
      return db
        .prepare("SELECT * FROM saved_snis WHERE region = ? OR region = 'GLOBAL' ORDER BY score DESC, created_at DESC")
        .all(region.toUpperCase());
    }
    return db.prepare('SELECT * FROM saved_snis ORDER BY score DESC, created_at DESC').all();
  }

  /**
   * Find by ID
   */
  static findById(id) {
    return db.prepare('SELECT * FROM saved_snis WHERE id = ?').get(id);
  }

  /**
   * Find by domain
   */
  static findByDomain(domain) {
    return db.prepare('SELECT * FROM saved_snis WHERE domain = ?').get(domain.toLowerCase().trim());
  }

  /**
   * Save or update an SNI candidate
   */
  static upsert(data) {
    const domain = (data.domain || '').toLowerCase().trim();
    if (!domain) throw new Error('Domain is required');

    const port = parseInt(data.port, 10) || 443;
    const score = Math.max(0, Math.min(100, parseInt(data.score, 10) || 0));
    const rating = data.rating || 'IDEAL';
    const tlsProtocol = data.tlsProtocol || data.tls?.protocol || '';
    const alpn = data.alpn || data.tls?.alpn || '';
    const matchesSan = data.matchesSan !== undefined ? (data.matchesSan ? 1 : 0) : (data.cert?.matchesDomain ? 1 : 0);
    const latencyMs = parseInt(data.latencyMs || data.totalLatencyMs, 10) || 0;
    const source = data.source || 'web_scourer';
    const region = (data.region || 'GLOBAL').toUpperCase();
    const notes = data.notes || data.desc || data.recommendation || '';

    const stmt = db.prepare(`
      INSERT INTO saved_snis (domain, port, score, rating, tls_protocol, alpn, matches_san, latency_ms, source, region, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        port = excluded.port,
        score = excluded.score,
        rating = excluded.rating,
        tls_protocol = excluded.tls_protocol,
        alpn = excluded.alpn,
        matches_san = excluded.matches_san,
        latency_ms = excluded.latency_ms,
        source = excluded.source,
        region = excluded.region,
        notes = excluded.notes
    `);

    stmt.run(domain, port, score, rating, tlsProtocol, alpn, matchesSan, latencyMs, source, region, notes);
    return this.findByDomain(domain);
  }

  /**
   * Delete by ID
   */
  static delete(id) {
    const res = db.prepare('DELETE FROM saved_snis WHERE id = ?').run(id);
    return res.changes > 0;
  }
}

module.exports = SavedSni;
