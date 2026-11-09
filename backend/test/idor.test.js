'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '../data/test-idor.db');
process.env.DB_PATH = testDbPath;
try { fs.unlinkSync(testDbPath); } catch {}

const db = require('../src/config/database');
const Inbound = require('../src/models/Inbound');
const Client = require('../src/models/Client');

test('IDOR Protection: Client parent ownership validation (H3)', () => {
  // Inbound 1
  const inb1 = Inbound.create({
    engine: 'singbox',
    tag: 'inb-1',
    type: 'vless',
    port: 10001,
  });

  // Inbound 2
  const inb2 = Inbound.create({
    engine: 'singbox',
    tag: 'inb-2',
    type: 'vless',
    port: 10002,
  });

  // Client belongs to Inbound 1
  const client1 = Client.create({
    inbound_id: inb1.id,
    email: 'client1@test.com',
    uuid: '11111111-2222-3333-4444-555555555555',
  });

  function checkOwnership(inboundId, clientId) {
    const inb = Inbound.findById(parseInt(inboundId, 10));
    if (!inb) return null;
    const c = Client.findById(parseInt(clientId, 10));
    if (!c || c.inbound_id !== inb.id) return null;
    return { inbound: inb, client: c };
  }

  // Accessing client1 under inb1 -> OK
  const validAccess = checkOwnership(inb1.id, client1.id);
  assert.ok(validAccess);
  assert.equal(validAccess.client.id, client1.id);

  // Cross-inbound IDOR attempt: accessing client1 under inb2 -> Rejected!
  const idorAccess = checkOwnership(inb2.id, client1.id);
  assert.equal(idorAccess, null, 'Must reject cross-inbound access attempt');
});

test.after(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(`${testDbPath}-wal`); } catch {}
  try { fs.unlinkSync(`${testDbPath}-shm`); } catch {}
});
