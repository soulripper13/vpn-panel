/**
 * utils/config-generator.js
 * Comprehensive configuration generators for sing-box and Xray-core.
 * Supports all modern protocols, transports, securities, and cipher suites.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { resolveTlsPair, isValidSniHost } = require('./tls-certs');

function parseRealityHandshake(dest, serverName) {
  const raw = String(dest || '').trim();
  if (raw) {
    // Handle IPv6 [::1]:443 or host:port
    const ipv6Match = raw.match(/^\[([^\]]+)\]:(\d+)$/);
    if (ipv6Match) {
      return { server: ipv6Match[1], server_port: parseInt(ipv6Match[2], 10) || 443 };
    }
    const lastColon = raw.lastIndexOf(':');
    if (lastColon > 0 && /^\d+$/.test(raw.slice(lastColon + 1))) {
      return {
        server: raw.slice(0, lastColon),
        server_port: parseInt(raw.slice(lastColon + 1), 10) || 443,
      };
    }
    return { server: raw, server_port: 443 };
  }
  return {
    server: isValidSniHost(serverName) ? serverName.trim() : 'www.microsoft.com',
    server_port: 443,
  };
}

function generateWireguardPrivateKey() {
  const keyPair = crypto.generateKeyPairSync('x25519');
  const privDer = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
  return privDer.subarray(-32).toString('base64');
}

function normalizeAlpn(alpn, fallback = ['h2', 'http/1.1']) {
  if (Array.isArray(alpn)) {
    const cleaned = alpn.map((a) => String(a || '').trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : fallback;
  }
  if (typeof alpn === 'string' && alpn.trim()) {
    const cleaned = alpn.split(',').map((a) => a.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : fallback;
  }
  return fallback;
}

/**
 * Generate a sing-box inbound JSON object
 */
function generateSingboxInbound(type, opts = {}) {
  const {
    tag = `in-${type}-${opts.port || 0}`,
    listen = '0.0.0.0',
    port = 0,
    // TLS / Reality
    tls = false,
    security = 'none',
    serverName = '',
    dest = '',
    privateKey = '',
    shortId = '',
    alpn,
    certMode = '',
    // Multiplex
    multiplex = false,
    // Transport
    transport = 'tcp',
    network = '',
    wsPath = '',
    wsHost = '',
    grpcServiceName = '',
    // Users / Clients
    users,
    password = '',
    // Shadowsocks
    method = '2022-blake3-aes-128-gcm',
    // ShadowTLS
    shadowtlsPassword = '',
    shadowtlsVersion = 3,
    detour = '',
    // Hysteria 2
    up_mbps = 100,
    down_mbps = 100,
    obfsPassword = '',
    ignoreClientBandwidth = false,
    // TUIC
    congestion_control = 'bbr',
    zero_rtt_handshake = true,
    // WireGuard
    private_key = '',
    peer_public_key = '',
    pre_shared_key = '',
    peers = [],
    local_address = ['10.0.0.1/24'],
  } = opts;

  const normalizedType = String(type || '').toLowerCase();
  const effectiveTransport = (network && network !== 'hysteria' ? network : transport) || 'tcp';
  const userListInput = Array.isArray(users) ? users : (Array.isArray(opts.clients) ? opts.clients : []);

  const base = {
    type: normalizedType,
    tag,
    listen,
    listen_port: parseInt(port, 10),
  };

  // VMess does not support Reality in sing-box
  const isReality = normalizedType !== 'vmess' && (security === 'reality' || Boolean(opts.realitySettings));
  const isTls = !isReality && (tls || security === 'tls' || normalizedType === 'trojan');

  const resolvedSni = (serverName || opts.sni || opts.tlsSettings?.serverName || '').trim();

  // TLS block for vless / vmess / trojan
  let tlsBlock = {};
  if (isReality) {
    const handshake = parseRealityHandshake(dest || opts.realitySettings?.dest, resolvedSni);
    const sId = shortId || opts.realitySettings?.shortIds?.[0] || '';
    tlsBlock = {
      tls: {
        enabled: true,
        server_name: resolvedSni || handshake.server,
        reality: {
          enabled: true,
          handshake,
          private_key: privateKey || opts.realitySettings?.privateKey || '',
          short_id: sId ? [sId] : [],
        },
      },
    };
  } else if (isTls) {
    const pair = resolveTlsPair({
      certificate_path: opts.certificate_path,
      certificateFile: opts.certificateFile,
      key_path: opts.key_path,
      keyFile: opts.keyFile,
      tlsSettings: opts.tlsSettings,
      serverName: resolvedSni || 'localhost',
      certMode,
    });
    tlsBlock = {
      tls: {
        enabled: true,
        ...(resolvedSni ? { server_name: resolvedSni } : {}),
        ...(alpn ? { alpn: normalizeAlpn(alpn) } : {}),
        certificate_path: pair.certificateFile,
        key_path: pair.keyFile,
      },
    };
  }

  // Transport block for sing-box (ws, grpc, httpupgrade)
  let transportBlock = {};
  if (effectiveTransport === 'ws') {
    transportBlock = {
      transport: {
        type: 'ws',
        path: wsPath || opts.wsSettings?.path || '/',
        headers: (wsHost || opts.wsSettings?.headers?.Host)
          ? { Host: wsHost || opts.wsSettings?.headers?.Host }
          : {},
      },
    };
  } else if (effectiveTransport === 'grpc') {
    transportBlock = {
      transport: {
        type: 'grpc',
        service_name: grpcServiceName || opts.grpcSettings?.serviceName || 'grpc',
      },
    };
  } else if (effectiveTransport === 'httpupgrade') {
    transportBlock = {
      transport: {
        type: 'httpupgrade',
        path: wsPath || '/',
        ...(wsHost ? { host: wsHost } : {}),
      },
    };
  }

  // Multiplex (incompatible with xtls-rprx-vision)
  const muxBlock = multiplex ? { multiplex: { enabled: true, padding: true } } : {};

  switch (normalizedType) {
    case 'shadowtls': {
      const stlsTag = tag;
      const ssTag = detour || `${tag}-ss`;
      const ssKey = opts.ssPassword || opts.password || crypto.randomBytes(16).toString('base64');
      const ssMethod = opts.ssMethod || method || '2022-blake3-aes-128-gcm';
      const sni = resolvedSni || 'gateway.icloud.com';
      const stlsVer = parseInt(shadowtlsVersion || opts.version || 3, 10);

      const stlsUsers = Array.isArray(users)
        ? users.map((u) => ({
            name: u.name || u.email || 'user',
            password: u.password || shadowtlsPassword || opts.password,
          }))
        : [{
            name: 'user',
            password: shadowtlsPassword || opts.password || crypto.randomBytes(16).toString('hex'),
          }];

      const stlsInbound = {
        type: 'shadowtls',
        tag: stlsTag,
        listen: listen === '0.0.0.0' ? '::' : listen,
        listen_port: parseInt(port, 10),
        version: stlsVer,
        users: stlsUsers,
        handshake: {
          server: sni,
          server_port: 443,
        },
        detour: ssTag,
      };

      const ssInbound = {
        type: 'shadowsocks',
        tag: ssTag,
        listen: '127.0.0.1',
        method: ssMethod,
        password: ssKey,
        ...muxBlock,
      };

      return [stlsInbound, ssInbound];
    }

    case 'shadowsocks':
      return {
        ...base,
        method,
        password: password || crypto.randomBytes(16).toString('base64'),
        ...(userListInput.length > 0
          ? {
              users: userListInput.map((u) => ({
                name: u.email || u.name || 'user',
                password: u.password || password,
              })),
            }
          : {}),
        ...muxBlock,
      };

    case 'vless': {
      const allowVisionFlow = effectiveTransport === 'tcp' && !multiplex;
      return {
        ...base,
        users: userListInput.map((u) => {
          const flowVal = allowVisionFlow
            ? (u.flow !== undefined ? u.flow : (isReality ? 'xtls-rprx-vision' : ''))
            : '';
          return {
            uuid: u.uuid || uuidv4(),
            ...(flowVal ? { flow: flowVal } : {}),
            name: u.email || u.name || '',
          };
        }),
        ...tlsBlock,
        ...transportBlock,
        ...muxBlock,
      };
    }

    case 'vmess':
      return {
        ...base,
        users: userListInput.map((u) => ({
          uuid: u.uuid || uuidv4(),
          alterId: u.alterId || 0,
          name: u.email || u.name || '',
        })),
        ...tlsBlock,
        ...transportBlock,
        ...muxBlock,
      };

    case 'trojan':
      return {
        ...base,
        users: userListInput.map((u) => ({
          password: u.password || u.uuid || uuidv4(),
          name: u.email || u.name || '',
        })),
        ...tlsBlock,
        ...transportBlock,
        ...muxBlock,
      };

    case 'hysteria':
    case 'hysteria2': {
      const hy2Sni = resolvedSni || 'gateway.icloud.com';
      const pair = resolveTlsPair({
        certificate_path: opts.certificate_path,
        certificateFile: opts.certificateFile,
        key_path: opts.key_path,
        keyFile: opts.keyFile,
        tlsSettings: opts.tlsSettings,
        serverName: hy2Sni,
        certMode,
      });

      return {
        ...base,
        type: 'hysteria2',
        up_mbps: parseInt(up_mbps || 100, 10),
        down_mbps: parseInt(down_mbps || 100, 10),
        ignore_client_bandwidth: Boolean(ignoreClientBandwidth),
        ...(obfsPassword ? { obfs: { type: 'salamander', password: obfsPassword } } : {}),
        users: userListInput.map((u) => ({
          password: u.password || uuidv4(),
          name: u.email || u.name || '',
        })),
        tls: {
          enabled: true,
          server_name: hy2Sni,
          alpn: ['h3'],
          certificate_path: pair.certificateFile,
          key_path: pair.keyFile,
        },
      };
    }

    case 'tuic': {
      const tuicSni = resolvedSni || 'localhost';
      const pair = resolveTlsPair({
        certificate_path: opts.certificate_path,
        certificateFile: opts.certificateFile,
        key_path: opts.key_path,
        keyFile: opts.keyFile,
        tlsSettings: opts.tlsSettings,
        serverName: tuicSni,
        certMode,
      });

      return {
        ...base,
        users: userListInput.map((u) => ({
          uuid: u.uuid || uuidv4(),
          password: u.password || uuidv4(),
          name: u.email || u.name || '',
        })),
        congestion_control,
        zero_rtt_handshake: Boolean(zero_rtt_handshake),
        tls: {
          enabled: true,
          server_name: tuicSni,
          alpn: ['h3'],
          certificate_path: pair.certificateFile,
          key_path: pair.keyFile,
        },
      };
    }

    case 'mixed':
    case 'socks':
      return {
        ...base,
        type: normalizedType === 'mixed' ? 'mixed' : 'socks',
        ...(userListInput.length > 0
          ? {
              users: userListInput.map((u) => ({
                username: u.email || u.name || '',
                password: u.password || uuidv4(),
              })),
            }
          : {}),
      };

    case 'wireguard': {
      const validPeers = (Array.isArray(peers) ? peers : []).filter((p) => p && p.public_key);
      if (validPeers.length === 0 && peer_public_key) {
        validPeers.push({
          public_key: peer_public_key,
          ...(pre_shared_key ? { pre_shared_key } : {}),
          allowed_ips: ['0.0.0.0/0', '::/0'],
        });
      }
      return {
        ...base,
        local_address: Array.isArray(local_address) ? local_address : [local_address || '10.0.0.1/24'],
        private_key: private_key || generateWireguardPrivateKey(),
        peers: validPeers,
      };
    }

    default:
      return base;
  }
}

/**
 * Generate an Xray inbound JSON object
 */
function generateXrayInbound(type, opts = {}) {
  const {
    tag = `in-${type}-${opts.port || 0}`,
    listen = '0.0.0.0',
    port = 0,
    // Security
    security = 'none',
    serverName = '',
    dest = '',
    serverNames = [],
    privateKey = '',
    shortIds = [],
    shortId = '',
    fingerprint = '',
    alpn,
    certMode = '',
    // Transport
    transport = 'tcp',
    network = '',
    wsPath = '',
    wsHost = '',
    grpcServiceName = '',
    // Clients
    clients = [],
    // Shadowsocks
    method = 'aes-128-gcm',
    password = uuidv4(),
    // Hysteria 2
    obfsPassword = '',
    // Sniffing
    sniffing = true,
  } = opts;

  const normalizedType = String(type || '').toLowerCase();
  const rawStreamSettings = opts.streamSettings || opts.stream_settings || {};
  const clientList = (clients && clients.length > 0) ? clients : (opts.users || []);
  const effectiveNetwork = (() => {
    if (rawStreamSettings.network && rawStreamSettings.network !== 'hysteria') {
      return rawStreamSettings.network;
    }
    if (network && network !== 'hysteria') return network;
    return transport || 'tcp';
  })();

  const effectiveSecurity = (() => {
    const sec = rawStreamSettings.security || security || 'none';
    // Xray VMess does not support Reality
    if (normalizedType === 'vmess' && sec === 'reality') return 'none';
    if (normalizedType === 'trojan' && sec === 'none' && !rawStreamSettings.realitySettings) return 'tls';
    return sec;
  })();

  // Stream settings builder (always emits clean Xray-native streamSettings)
  const buildStreamSettings = () => {
    const ss = { network: effectiveNetwork };

    if (effectiveNetwork === 'tcp') {
      ss.tcpSettings = rawStreamSettings.tcpSettings || { header: { type: 'none' } };
    } else if (effectiveNetwork === 'ws') {
      const resolvedWsPath = wsPath || rawStreamSettings.wsSettings?.path || rawStreamSettings.wsPath || '/';
      const resolvedWsHost = wsHost || rawStreamSettings.wsSettings?.headers?.Host || rawStreamSettings.wsHost || '';
      ss.wsSettings = {
        path: resolvedWsPath,
        headers: resolvedWsHost ? { Host: resolvedWsHost } : {},
      };
    } else if (effectiveNetwork === 'grpc') {
      ss.grpcSettings = {
        serviceName: grpcServiceName || rawStreamSettings.grpcSettings?.serviceName || rawStreamSettings.grpcServiceName || 'grpc',
        multiMode: rawStreamSettings.grpcSettings?.multiMode ?? true,
      };
    } else if (effectiveNetwork === 'httpupgrade') {
      ss.httpupgradeSettings = {
        path: wsPath || rawStreamSettings.httpupgradeSettings?.path || rawStreamSettings.wsPath || '/',
        host: wsHost || rawStreamSettings.httpupgradeSettings?.host || rawStreamSettings.wsHost || '',
      };
    } else if (effectiveNetwork === 'splithttp') {
      ss.splithttpSettings = {
        path: wsPath || rawStreamSettings.splithttpSettings?.path || rawStreamSettings.wsPath || '/',
        host: wsHost || rawStreamSettings.splithttpSettings?.host || rawStreamSettings.wsHost || '',
      };
    }

    const resolvedSni = (
      serverName ||
      rawStreamSettings.tlsSettings?.serverName ||
      rawStreamSettings.serverName ||
      opts.sni ||
      ''
    ).trim();

    if (effectiveSecurity === 'tls') {
      ss.security = 'tls';
      const pair = resolveTlsPair({
        certificateFile: opts.certificateFile || rawStreamSettings.certificateFile,
        keyFile: opts.keyFile || rawStreamSettings.keyFile,
        tlsSettings: rawStreamSettings.tlsSettings,
        serverName: resolvedSni || 'localhost',
        certMode: certMode || rawStreamSettings.certMode,
      });

      ss.tlsSettings = {
        serverName: resolvedSni,
        alpn: normalizeAlpn(rawStreamSettings.tlsSettings?.alpn || rawStreamSettings.alpn || alpn, ['h2', 'http/1.1']),
        certificates: [
          {
            certificateFile: pair.certificateFile,
            keyFile: pair.keyFile,
          },
        ],
      };
    } else if (effectiveSecurity === 'reality') {
      ss.security = 'reality';
      const rawReal = rawStreamSettings.realitySettings || {};
      const realSni = resolvedSni || rawReal.serverNames?.[0] || serverNames[0] || 'www.microsoft.com';
      const target = dest || rawReal.dest || rawReal.target || `${realSni}:443`;
      const allServerNames = (Array.isArray(rawReal.serverNames) && rawReal.serverNames.length > 0)
        ? rawReal.serverNames
        : (serverNames.length > 0 ? serverNames : [realSni]);
      const rawShortId = shortId || rawStreamSettings.shortId || '';
      const allShortIds = (Array.isArray(rawReal.shortIds) && rawReal.shortIds.length > 0)
        ? rawReal.shortIds
        : (shortIds.length > 0 ? shortIds : (rawShortId ? [rawShortId] : ['']));

      ss.realitySettings = {
        show: false,
        dest: target,
        xver: rawReal.xver || 0,
        serverNames: allServerNames,
        privateKey: rawReal.privateKey || privateKey || '',
        shortIds: allShortIds,
        fingerprint: rawReal.fingerprint || fingerprint || 'chrome',
        ...(rawReal.minClientVer ? { minClientVer: rawReal.minClientVer } : {}),
        ...(rawReal.maxClientVer ? { maxClientVer: rawReal.maxClientVer } : {}),
        ...(rawReal.maxTimediff ? { maxTimediff: rawReal.maxTimediff } : {}),
      };
    } else {
      ss.security = 'none';
    }

    return ss;
  };

  const sniffBlock = sniffing
    ? {
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls', 'quic', 'fakedns'],
          routeOnly: true,
        },
      }
    : { sniffing: { enabled: false } };

  switch (normalizedType) {
    case 'vless': {
      const vlessStreamSettings = buildStreamSettings();
      const allowVisionFlow = vlessStreamSettings.network === 'tcp' && vlessStreamSettings.security === 'reality';

      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'vless',
        settings: {
          clients: clientList.map((c) => {
            const flowVal = allowVisionFlow ? (c.flow || 'xtls-rprx-vision') : '';
            return {
              id: c.uuid || c.id || uuidv4(),
              flow: flowVal,
              email: c.email || '',
            };
          }),
          decryption: opts.decryption || 'none',
          ...(opts.testseed ? { testseed: opts.testseed } : {}),
        },
        streamSettings: vlessStreamSettings,
        ...sniffBlock,
      };
    }

    case 'vmess':
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'vmess',
        settings: {
          clients: clientList.map((c) => ({
            id: c.uuid || uuidv4(),
            alterId: c.alterId || 0,
            email: c.email || '',
          })),
        },
        streamSettings: buildStreamSettings(),
        ...sniffBlock,
      };

    case 'trojan':
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'trojan',
        settings: {
          clients: clientList.map((c) => ({
            password: c.password || c.uuid || uuidv4(),
            email: c.email || '',
            flow: c.flow || '',
          })),
        },
        streamSettings: buildStreamSettings(),
        ...sniffBlock,
      };

    case 'hysteria':
    case 'hysteria2': {
      const hysteriaClients = clientList.map((c) => ({
        auth: c.password || c.uuid || c.auth || uuidv4().replace(/-/g, '').slice(0, 16),
        email: c.email || '',
      }));

      const sniName = (
        serverName ||
        opts.sni ||
        rawStreamSettings.serverName ||
        rawStreamSettings.tlsSettings?.serverName ||
        'gateway.icloud.com'
      ).trim();

      const pair = resolveTlsPair({
        certificateFile: opts.certificateFile || rawStreamSettings.certificateFile,
        keyFile: opts.keyFile || rawStreamSettings.keyFile,
        tlsSettings: rawStreamSettings.tlsSettings,
        serverName: sniName,
        certMode: certMode || rawStreamSettings.certMode,
      });

      const effectiveObfs = (obfsPassword !== undefined && obfsPassword !== null)
        ? String(obfsPassword).trim()
        : (rawStreamSettings.obfsPassword || '');

      const hy2StreamSettings = {
        network: 'hysteria',
        security: 'tls',
        hysteriaSettings: {
          auth: '',
          udpIdleTimeout: 60,
          version: 2,
        },
        tlsSettings: {
          alpn: ['h3'],
          serverName: sniName,
          certificates: [
            { certificateFile: pair.certificateFile, keyFile: pair.keyFile },
          ],
        },
        ...(effectiveObfs
          ? {
              finalmask: {
                udp: [
                  {
                    type: 'salamander',
                    settings: { password: effectiveObfs },
                  },
                ],
              },
            }
          : {}),
      };

      return {
        tag,
        listen: listen === '0.0.0.0' ? '::' : listen,
        port: parseInt(port, 10),
        protocol: 'hysteria',
        settings: {
          clients: hysteriaClients,
          version: 2,
        },
        streamSettings: hy2StreamSettings,
        sniffing: { enabled: false },
      };
    }

    case 'shadowsocks': {
      const is2022 = String(method || '').startsWith('2022-');
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'shadowsocks',
        settings: {
          method,
          password: password || crypto.randomBytes(16).toString('base64'),
          network: 'tcp,udp',
          ...(clientList.length > 0
            ? {
                clients: clientList.map((c) => ({
                  password: c.password || crypto.randomBytes(16).toString('base64'),
                  email: c.email || '',
                  ...(is2022 ? {} : { method: c.method || method }),
                })),
              }
            : {}),
        },
        streamSettings: { network: 'tcp', security: 'none' },
      };
    }

    case 'socks': {
      const accounts = clientList.map((c) => ({
        user: c.email || '',
        pass: c.password || uuidv4(),
      }));
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'socks',
        settings: {
          auth: accounts.length > 0 ? 'password' : 'noauth',
          ...(accounts.length > 0 ? { accounts } : {}),
          udp: true,
        },
        ...sniffBlock,
      };
    }

    case 'http': {
      const accounts = clientList.map((c) => ({
        user: c.email || '',
        pass: c.password || uuidv4(),
      }));
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'http',
        settings: {
          allowTransparent: false,
          ...(accounts.length > 0 ? { accounts } : {}),
        },
        ...sniffBlock,
      };
    }

    default:
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: type,
        settings: {},
        streamSettings: buildStreamSettings(),
      };
  }
}

module.exports = {
  generateSingboxInbound,
  generateXrayInbound,
};
