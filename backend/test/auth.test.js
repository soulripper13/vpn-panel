'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Use isolated test DB
const testDbPath = path.join(__dirname, '../data/test-auth.db');
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret-key-32-chars-long-abc';

try { fs.unlinkSync(testDbPath); } catch {}

const db = require('../src/config/database');
const User = require('../src/models/User');
const SqliteSessionStore = require('../src/utils/session-store');
const { csrfProtection, isValidOrigin } = require('../src/middleware/csrf');

test('Auth: User creation, password hashing, and verification', () => {
  const username = `testadmin_${Date.now()}`;
  const pass = 'SecurePass123!';
  const { id } = User.create({ username, password: pass, role: 'admin' });
  assert.ok(id > 0);

  const user = User.findById(id);
  assert.equal(user.username, username);
  assert.equal(user.role, 'admin');

  const fullUser = User.findByUsername(username);
  assert.equal(User.verifyPassword(pass, fullUser.password_hash), true);
  assert.equal(User.verifyPassword('WrongPass', fullUser.password_hash), false);
});

test('Auth: SqliteSessionStore persists sessions and destroys sessions for user', (t, done) => {
  const store = new SqliteSessionStore({ db });
  const sid = 'sess_test_123';
  const sessData = {
    cookie: { maxAge: 3600000 },
    user: { id: 99, username: 'testuser', role: 'admin' },
  };

  store.set(sid, sessData, (err) => {
    assert.ifError(err);

    store.get(sid, (getErr, loaded) => {
      assert.ifError(getErr);
      assert.equal(loaded.user.username, 'testuser');

      // Test destroyAllForUser
      store.destroyAllForUser(99);
      store.get(sid, (afterErr, afterDestroy) => {
        assert.ifError(afterErr);
        assert.equal(afterDestroy, null);
        done();
      });
    });
  });
});

test('Auth: CSRF and Origin protection', () => {
  // Valid origin
  const reqValid = {
    headers: { origin: 'http://127.0.0.1:2096', host: '127.0.0.1:2096' },
  };
  assert.equal(isValidOrigin(reqValid), true);

  // Mismatched origin (cross-origin attack)
  const reqInvalid = {
    headers: { origin: 'http://malicious-site.com', host: '127.0.0.1:2096' },
  };
  assert.equal(isValidOrigin(reqInvalid), false);
});

test.after(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(`${testDbPath}-wal`); } catch {}
  try { fs.unlinkSync(`${testDbPath}-shm`); } catch {}
});
