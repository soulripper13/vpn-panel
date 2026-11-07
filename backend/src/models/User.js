/**
 * models/User.js
 * Data-access methods for the `users` table.
 */

'use strict';

const db     = require('../config/database');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;

class User {
  // ─── Finders ────────────────────────────────────────────────────────────────

  static findById(id) {
    return db.prepare(`SELECT id, username, role, created_at FROM users WHERE id = ?`).get(id);
  }

  static findByUsername(username) {
    return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
  }

  static findAll() {
    return db.prepare(`SELECT id, username, role, created_at FROM users ORDER BY id`).all();
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Create a new user.
   * @param {object} param0
   * @param {string} param0.username
   * @param {string} param0.password  Plain-text password — will be hashed.
   * @param {string} [param0.role='admin']
   * @returns {{ id: number }}
   */
  static create({ username, password, role = 'admin' }) {
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`
    ).run(username, hash, role);
    return { id: info.lastInsertRowid };
  }

  /**
   * Update the password for a user.
   * @param {number} id
   * @param {string} newPassword  Plain-text.
   */
  static updatePassword(id, newPassword) {
    const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id);
  }

  static delete(id) {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  /**
   * Verify plain-text password against stored hash.
   * @param {string} plain
   * @param {string} hash
   * @returns {boolean}
   */
  static verifyPassword(plain, hash) {
    return bcrypt.compareSync(plain, hash);
  }
}

module.exports = User;
