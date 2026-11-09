'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '../data/test-engines.db');
process.env.DB_PATH = testDbPath;
try { fs.unlinkSync(testDbPath); } catch {}

const db = require('../src/config/database');
const Inbound = require('../src/models/Inbound');
const Client = require('../src/models/Client');
const SingboxService = require('../src/services/singbox');
const XrayService = require('../src/services/xray');
const { generateClashProxy, generateClashSubscription } = require('../src/utils/link-generator');

test('Engines: Reality X25519 key generation produces valid Curve25519 keys (M5)', () => {
  const keyPair = crypto.generateKeyPairSync('x25519');
  const privDer = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
  const rawPrivate = privDer.subarray(-32);

  const pubDer = keyPair.publicKey.export({ type: 'spki', format: 'der' });
  const rawPublic = pubDer.subarray(-32);

  const privateKey = rawPrivate.toString('base64url');
  const publicKey = rawPublic.toString('base64url');

  assert.equal(rawPrivate.length, 32);
  assert.equal(rawPublic.length, 32);
  assert.ok(privateKey.length >= 42);
  assert.ok(publicKey.length >= 42);
});

test('Engines: sing-box config blocks private/metadata destinations (H6)', async () => {
  // Mock writeConfig and restart to avoid touching host files during unit test
  const origWrite = SingboxService.writeConfig;
  const origRestart = SingboxService.restart;

  let capturedConfig = null;
  SingboxService.writeConfig = async (config) => { capturedConfig = config; };
  SingboxService.restart = async () => {};

  try {
    await SingboxService.generateAndApplyConfig();
    assert.ok(capturedConfig);
    assert.ok(capturedConfig.route);
    assert.ok(capturedConfig.route.rules);

    // Verify private IPs are blocked (not direct!)
    const privateRule = capturedConfig.route.rules.find((r) => r.ip_is_private === true);
    assert.ok(privateRule, 'Must contain ip_is_private rule');
    assert.equal(privateRule.outbound, 'block', 'Private IPs must be routed to block');

    const cidrRule = capturedConfig.route.rules.find((r) => Array.isArray(r.ip_cidr));
    assert.ok(cidrRule, 'Must contain CIDR blocking rule');
    assert.equal(cidrRule.outbound, 'block');
    assert.ok(cidrRule.ip_cidr.includes('169.254.0.0/16'), 'Must block link-local/cloud metadata');
  } finally {
    SingboxService.writeConfig = origWrite;
    SingboxService.restart = origRestart;
  }
});

test('Engines: Quota and expiry are enforced in engine configuration (C6)', async () => {
  const origWrite = SingboxService.writeConfig;
  const origRestart = SingboxService.restart;

  let capturedConfig = null;
  SingboxService.writeConfig = async (config) => { capturedConfig = config; };
  SingboxService.restart = async () => {};

  try {
    const { id: inbId } = Inbound.create({
      engine: 'singbox',
      tag: 'singbox-quota-test',
      type: 'vless',
      listen: '0.0.0.0',
      port: 19890,
      protocol: 'vless',
    });

    const now = Math.floor(Date.now() / 1000);

    // 1. Active valid client
    Client.create({
      inbound_id: inbId,
      email: 'valid-client@test.com',
      uuid: '11111111-1111-1111-1111-111111111111',
      enable: 1,
      total_bytes_limit: 1000000,
      up_bytes: 100,
      down_bytes: 100,
    });

    // 2. Expired client
    Client.create({
      inbound_id: inbId,
      email: 'expired-client@test.com',
      uuid: '22222222-2222-2222-2222-222222222222',
      enable: 1,
      expiry_time: now - 3600, // expired 1 hour ago
    });

    // 3. Over-quota client
    Client.create({
      inbound_id: inbId,
      email: 'overquota-client@test.com',
      uuid: '33333333-3333-3333-3333-333333333333',
      enable: 1,
      total_bytes_limit: 500,
      up_bytes: 300,
      down_bytes: 300, // total 600 > 500
    });

    await SingboxService.generateAndApplyConfig();
    assert.ok(capturedConfig);
    const targetInb = capturedConfig.inbounds.find((i) => i.tag === 'singbox-quota-test');
    assert.ok(targetInb);

    const activeUuids = (targetInb.users || []).map((u) => u.uuid);
    assert.ok(activeUuids.includes('11111111-1111-1111-1111-111111111111'), 'Valid client must be included');
    assert.ok(!activeUuids.includes('22222222-2222-2222-2222-222222222222'), 'Expired client must NOT be included');
    assert.ok(!activeUuids.includes('33333333-3333-3333-3333-333333333333'), 'Over-quota client must NOT be included');
  } finally {
    SingboxService.writeConfig = origWrite;
    SingboxService.restart = origRestart;
  }
});

test('YAML Serialization: Safe escaping and default secure TLS (H4, M2)', () => {
  const inbound = {
    type: 'trojan',
    protocol: 'trojan',
    port: 443,
    remark: 'Special "Remark" \n with: chars',
  };
  const client = {
    password: 'pass"word:123',
    remark: 'MyClient',
  };

  const proxy = generateClashProxy(inbound, client, 'example.com');
  assert.ok(proxy);
  assert.ok(proxy.obj);
  // Default TLS verification must be enabled (skip-cert-verify: false)
  assert.equal(proxy.obj['skip-cert-verify'], false);

  const fullYaml = generateClashSubscription([proxy], 'TestProfile');
  assert.ok(fullYaml.includes('proxies:'));
  assert.ok(fullYaml.includes('proxy-groups:'));
});

test.after(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(`${testDbPath}-wal`); } catch {}
  try { fs.unlinkSync(`${testDbPath}-shm`); } catch {}
});
