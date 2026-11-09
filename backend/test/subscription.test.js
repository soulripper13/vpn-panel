'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '../data/test-sub.db');
process.env.DB_PATH = testDbPath;
try { fs.unlinkSync(testDbPath); } catch {}

const db = require('../src/config/database');
const Inbound = require('../src/models/Inbound');
const Client = require('../src/models/Client');

test('Subscription: Random token creation, lookup, and guessable token rejection (C1)', () => {
  // Create an inbound
  const { id: inbId } = Inbound.create({
    engine: 'singbox',
    tag: `test-sub-inb-${Date.now()}`,
    type: 'vless',
    listen: '0.0.0.0',
    port: 33445,
    protocol: 'vless',
  });

  // Create client
  const email = `subuser_${Date.now()}@example.com`;
  const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const { id: clientId, rawSubToken } = Client.create({
    inbound_id: inbId,
    email,
    uuid,
    password: 'secretpassword',
    enable: 1,
  });

  assert.ok(rawSubToken);
  assert.ok(rawSubToken.length >= 64); // 32 bytes hex = 64 characters

  // 1. Valid high-entropy token lookup succeeds
  const found = Client.findBySubToken(rawSubToken);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, clientId);
  assert.equal(found[0].email, email);

  // 2. Guessable inputs are rejected (C1)
  assert.deepEqual(Client.findBySubToken(String(clientId)), []);
  assert.deepEqual(Client.findBySubToken(email), []);
  assert.deepEqual(Client.findBySubToken(uuid), []);
  assert.deepEqual(Client.findBySubToken(`inbound:${inbId}`), []);
  assert.deepEqual(Client.findBySubToken(`inbound-${inbId}`), []);

  // 3. Token Rotation
  const newSubToken = Client.rotateSubToken(clientId);
  assert.notEqual(newSubToken, rawSubToken);
  // Old token now invalid
  assert.deepEqual(Client.findBySubToken(rawSubToken), []);
  // New token works
  const foundNew = Client.findBySubToken(newSubToken);
  assert.equal(foundNew.length, 1);
  assert.equal(foundNew[0].id, clientId);

  // 4. Token Revocation
  Client.revokeSubToken(clientId);
  assert.deepEqual(Client.findBySubToken(newSubToken), []);
});

test('Subscription: Data sanitization and secret masking (H1)', () => {
  const client = {
    id: 1,
    email: 'user@domain.com',
    uuid: '12345678-abcd-ef01-2345-6789abcdef01',
    password: 'SuperSecretPassword',
    sub_token_hash: 'abcdef1234567890',
    sub_revoked: 0,
  };

  const safe = Client.toSafeObject(client, false);
  assert.equal(safe.password, '••••••••');
  assert.equal(safe.uuid, '12345678••••••••');
  assert.equal(safe.sub_token_hash, undefined);
  assert.equal(safe.hasSubToken, true);

  const revealed = Client.toSafeObject(client, true);
  assert.equal(revealed.password, 'SuperSecretPassword');
  assert.equal(revealed.uuid, '12345678-abcd-ef01-2345-6789abcdef01');
  assert.equal(revealed.sub_token_hash, undefined);
});

test.after(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(`${testDbPath}-wal`); } catch {}
  try { fs.unlinkSync(`${testDbPath}-shm`); } catch {}
});
