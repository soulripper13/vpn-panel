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
const { generateSingboxInbound, generateXrayInbound } = require('../src/utils/config-generator');
const {
  generateClientLink,
  generateClashProxy,
  generateClashSubscription,
  generateSingboxConfig,
} = require('../src/utils/link-generator');
const { getCertStorageDir } = require('../src/utils/tls-certs');

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

test('Shadow-TLS: Clash proxy has udp: false and sing-box client has correct detour order', () => {
  const { generateSingboxConfig } = require('../src/utils/link-generator');
  const inbound = {
    type: 'shadowtls',
    protocol: 'shadowtls',
    port: 443,
    settings: {
      serverName: 'download.nvidia.com',
      ssPassword: 'test-ss-password',
      shadowtlsPassword: 'test-stls-password',
      ssMethod: '2022-blake3-aes-128-gcm',
    },
  };
  const client = {
    password: 'test-stls-password',
    remark: 'StlsClient',
  };

  const clashProxy = generateClashProxy(inbound, client, 'example.com');
  assert.ok(clashProxy);
  assert.equal(clashProxy.obj.udp, false, 'Shadow-TLS Clash proxy must set udp: false to prevent DNS/UDP stalls');

  const singboxRaw = generateSingboxConfig(inbound, client, 'example.com');
  const singboxConfig = JSON.parse(singboxRaw);
  assert.ok(Array.isArray(singboxConfig.outbounds));
  const ssOut = singboxConfig.outbounds.find((o) => o.type === 'shadowsocks');
  const stlsOut = singboxConfig.outbounds.find((o) => o.type === 'shadowtls');
  assert.ok(ssOut && stlsOut);
  assert.equal(ssOut.detour, stlsOut.tag, 'Shadowsocks client outbound must detour to shadowtls');
  assert.equal(stlsOut.detour, undefined, 'Shadowtls client outbound must NOT detour back to shadowsocks');
});

test('Hysteria2 with camouflage SNI gateway.icloud.com auto-generates self-signed cert and valid client exports', () => {
  const sni = 'gateway.icloud.com';
  const sbInb = generateSingboxInbound('hysteria2', {
    tag: 'hy2-ru-test',
    port: 8443,
    serverName: sni,
    obfsPassword: 'obfs-secret-pass',
    certMode: 'selfsigned',
    users: [{ email: 'ru-user', password: 'hy2-auth-password' }],
  });

  assert.equal(sbInb.type, 'hysteria2');
  assert.equal(sbInb.tls.enabled, true);
  assert.equal(sbInb.tls.server_name, sni);
  assert.deepEqual(sbInb.tls.alpn, ['h3']);
  assert.ok(sbInb.tls.certificate_path && fs.existsSync(sbInb.tls.certificate_path), 'sing-box cert file must exist');
  assert.ok(sbInb.tls.key_path && fs.existsSync(sbInb.tls.key_path), 'sing-box key file must exist');

  const xrInb = generateXrayInbound('hysteria2', {
    tag: 'xray-hy2-ru-test',
    port: 8444,
    serverName: sni,
    obfsPassword: 'obfs-secret-pass',
    certMode: 'selfsigned',
    clients: [{ email: 'ru-user', password: 'hy2-auth-password' }],
  });

  assert.equal(xrInb.protocol, 'hysteria');
  assert.equal(xrInb.streamSettings.security, 'tls');
  assert.equal(xrInb.streamSettings.tlsSettings.serverName, sni);
  assert.deepEqual(xrInb.streamSettings.tlsSettings.alpn, ['h3']);
  assert.ok(fs.existsSync(xrInb.streamSettings.tlsSettings.certificates[0].certificateFile), 'xray cert file must exist');
  assert.ok(fs.existsSync(xrInb.streamSettings.tlsSettings.certificates[0].keyFile), 'xray key file must exist');

  // Verify client exports honor insecure=true and sing-box server_ports array format
  const inboundRecord = {
    type: 'hysteria2',
    protocol: 'hysteria2',
    port: 8443,
    remark: 'RU-Hy2',
    settings: {
      serverName: sni,
      obfsPassword: 'obfs-secret-pass',
      ports: '20000-50000',
      hopInterval: '5-10',
      insecure: true,
    },
    stream_settings: {
      network: 'hysteria',
      security: 'tls',
      serverName: sni,
      obfsPassword: 'obfs-secret-pass',
      ports: '20000-50000',
      insecure: true,
    },
  };
  const client = { password: 'hy2-auth-password', email: 'ru-user' };

  const uri = generateClientLink(inboundRecord, client, '1.2.3.4');
  assert.ok(uri.startsWith('hy2://hy2-auth-password@1.2.3.4:8443/?'));
  assert.ok(uri.includes('sni=gateway.icloud.com'));
  assert.ok(uri.includes('insecure=1'));
  assert.ok(uri.includes('mport=20000-50000'));

  const clash = generateClashProxy(inboundRecord, client, '1.2.3.4');
  assert.equal(clash.obj['skip-cert-verify'], true);
  assert.equal(clash.obj.sni, sni);

  const sbClient = JSON.parse(generateSingboxConfig(inboundRecord, client, '1.2.3.4'));
  assert.deepEqual(sbClient.outbounds[0].server_ports, ['20000:50000']);
  assert.equal(sbClient.outbounds[0].tls.insecure, true);
  assert.equal(sbClient.outbounds[0].tls.server_name, sni);
});

test('Xray & sing-box normalize UI stream_settings for VLESS/VMess/Trojan and WireGuard', () => {
  // 1. Xray VLESS TLS without streamSettings object must not throw
  const xrVlessTls = generateXrayInbound('vless', {
    port: 443,
    security: 'tls',
    transport: 'ws',
    wsPath: '/ws-path',
    wsHost: 'cdn.example.com',
    serverName: 'cdn.example.com',
    certMode: 'selfsigned',
    clients: [{ uuid: '11111111-1111-1111-1111-111111111111', email: 'u1' }],
  });
  assert.equal(xrVlessTls.streamSettings.network, 'ws');
  assert.equal(xrVlessTls.streamSettings.wsSettings.path, '/ws-path');
  assert.equal(xrVlessTls.streamSettings.wsSettings.headers.Host, 'cdn.example.com');
  assert.equal(xrVlessTls.streamSettings.security, 'tls');
  assert.ok(xrVlessTls.streamSettings.tlsSettings.certificates[0].certificateFile);

  // 2. Xray VMess with flat UI stream_settings must build proper wsSettings & tlsSettings
  const xrVmess = generateXrayInbound('vmess', {
    port: 8080,
    streamSettings: {
      network: 'ws',
      security: 'tls',
      wsPath: '/vmess-ws',
      wsHost: 'ws.example.com',
      serverName: 'ws.example.com',
      certMode: 'selfsigned',
      ports: '20000-50000', // stale UI field must not leak into Xray config
    },
    clients: [{ uuid: '11111111-1111-1111-1111-111111111111', email: 'vm1' }],
  });
  assert.equal(xrVmess.streamSettings.wsSettings.path, '/vmess-ws');
  assert.equal(xrVmess.streamSettings.ports, undefined);
  assert.equal(xrVmess.streamSettings.security, 'tls');
  assert.ok(xrVmess.streamSettings.tlsSettings.certificates[0].certificateFile);

  // 3. sing-box VLESS over WS must not set xtls-rprx-vision flow
  const sbVlessWs = generateSingboxInbound('vless', {
    port: 2053,
    transport: 'ws',
    wsPath: '/vless',
    security: 'tls',
    serverName: 'example.com',
    certMode: 'selfsigned',
    users: [{ uuid: '11111111-1111-1111-1111-111111111111', flow: 'xtls-rprx-vision', email: 'u2' }],
  });
  assert.equal(sbVlessWs.users[0].flow, undefined);
  assert.equal(sbVlessWs.transport.type, 'ws');

  // 4. sing-box WireGuard generates valid base64 private_key and local_address
  const sbWg = generateSingboxInbound('wireguard', { port: 51820 });
  assert.ok(sbWg.private_key && Buffer.from(sbWg.private_key, 'base64').length === 32);
  assert.deepEqual(sbWg.local_address, ['10.0.0.1/24']);
});

test('TUIC & Trojan Clash/Sing-box client exports include full credentials and TLS settings', () => {
  const tuicInb = {
    type: 'tuic',
    protocol: 'tuic',
    port: 8445,
    remark: 'TUIC-Node',
    settings: { congestion_control: 'bbr', zero_rtt_handshake: true, serverName: 'gateway.icloud.com', insecure: true },
    stream_settings: { security: 'tls', serverName: 'gateway.icloud.com', insecure: true },
  };
  const tuicClient = { uuid: '11111111-1111-1111-1111-111111111111', password: 'tuic-pass', email: 'tuic1' };

  const tuicUri = generateClientLink(tuicInb, tuicClient, '1.2.3.4');
  assert.ok(tuicUri.includes('allow_insecure=1'));
  const tuicClash = generateClashProxy(tuicInb, tuicClient, '1.2.3.4');
  assert.equal(tuicClash.obj.type, 'tuic');
  assert.equal(tuicClash.obj['skip-cert-verify'], true);
  const tuicSb = JSON.parse(generateSingboxConfig(tuicInb, tuicClient, '1.2.3.4'));
  assert.equal(tuicSb.outbounds[0].type, 'tuic');
  assert.equal(tuicSb.outbounds[0].uuid, tuicClient.uuid);
  assert.equal(tuicSb.outbounds[0].tls.insecure, true);
});

test('Inbound.update and Client.update succeed when changing port/fields (named @id fix)', () => {
  const { id: inbId } = Inbound.create({
    engine: 'singbox',
    tag: `update-test-${Date.now()}`,
    type: 'hysteria2',
    port: 19901,
    remark: 'Before',
  });
  Inbound.update(inbId, { port: 19902, remark: 'After' });
  const updatedInb = Inbound.findById(inbId);
  assert.equal(updatedInb.port, 19902);
  assert.equal(updatedInb.remark, 'After');

  const { id: clientId } = Client.create({
    inbound_id: inbId,
    email: 'edit-client@test.com',
    password: 'old-password',
  });
  Client.update(clientId, { password: 'new-password', remark: 'Updated' });
  const updatedClient = Client.findById(clientId);
  assert.equal(updatedClient.password, 'new-password');
  assert.equal(updatedClient.remark, 'Updated');
});

test('Non-ShadowTLS protocols never emit ss:// or shadow-tls even if legacy settings contain shadowtlsPassword', () => {
  const cases = [
    { type: 'hysteria2', expectedPrefix: 'hy2://', expectedType: 'hysteria2' },
    { type: 'vless', expectedPrefix: 'vless://', expectedType: 'vless' },
    { type: 'vmess', expectedPrefix: 'vmess://', expectedType: 'vmess' },
    { type: 'trojan', expectedPrefix: 'trojan://', expectedType: 'trojan' },
    { type: 'tuic', expectedPrefix: 'tuic://', expectedType: 'tuic' },
  ];

  for (const tc of cases) {
    const inbound = {
      type: tc.type,
      protocol: tc.type,
      port: 14443,
      remark: `${tc.type}-node`,
      settings: {
        shadowtlsPassword: 'stale-stls-password-from-old-modal',
        ssMethod: '2022-blake3-aes-128-gcm',
        ssPassword: 'stale-ss-password',
        serverName: 'gateway.icloud.com',
        insecure: true,
      },
      stream_settings: {
        security: 'tls',
        network: tc.type === 'vmess' ? 'ws' : 'tcp',
        serverName: 'gateway.icloud.com',
        insecure: true,
      },
    };
    const client = { uuid: '11111111-1111-1111-1111-111111111111', password: 'user-pass', email: 'u1' };

    const link = generateClientLink(inbound, client, '1.2.3.4');
    assert.ok(link.startsWith(tc.expectedPrefix), `${tc.type} link must start with ${tc.expectedPrefix}, got ${link}`);

    const clash = generateClashProxy(inbound, client, '1.2.3.4');
    assert.equal(clash.obj.type, tc.expectedType, `${tc.type} Clash proxy must be ${tc.expectedType}`);

    const sb = JSON.parse(generateSingboxConfig(inbound, client, '1.2.3.4'));
    assert.equal(sb.outbounds[0].type, tc.expectedType, `${tc.type} Sing-box outbound must be ${tc.expectedType}`);
  }
});

test.after(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(`${testDbPath}-wal`); } catch {}
  try { fs.unlinkSync(`${testDbPath}-shm`); } catch {}
  try { fs.rmSync(getCertStorageDir(), { recursive: true, force: true }); } catch {}
});
