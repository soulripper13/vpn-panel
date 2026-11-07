/**
 * utils/config-generator.js
 * Comprehensive configuration generators for sing-box and Xray-core.
 * Supports all modern protocols, transports, securities, and cipher suites.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const cfg = require('../config/app-config');

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
    privateKey = '',
    publicKey = '',
    shortId = '',
    // Multiplex
    multiplex = false,
    // Transport
    transport = 'tcp',
    wsPath = '/',
    wsHost = '',
    grpcServiceName = '',
    // Users / Clients
    users = [],
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
  } = opts;

  const base = {
    type,
    tag,
    listen,
    listen_port: parseInt(port, 10),
  };

  const isTls = tls || security === 'tls';
  const isReality = security === 'reality';

  // TLS block
  const tlsBlock = (isTls || isReality)
    ? {
        tls: {
          enabled: true,
          server_name: serverName,
          ...(isReality
            ? {
                reality: {
                  enabled: true,
                  handshake: {
                    server: serverName || 'www.microsoft.com',
                    server_port: 443,
                  },
                  private_key: privateKey,
                  short_id: shortId ? [shortId] : [],
                },
              }
            : {
                certificate_path: cfg.CERT_FULLCHAIN,
                key_path: cfg.CERT_PRIVKEY,
              }),
        },
      }
    : {};

  // Transport block for sing-box (ws, grpc)
  let transportBlock = {};
  if (transport === 'ws') {
    transportBlock = {
      transport: {
        type: 'ws',
        path: wsPath || '/',
        headers: wsHost ? { Host: wsHost } : {},
      },
    };
  } else if (transport === 'grpc') {
    transportBlock = {
      transport: {
        type: 'grpc',
        service_name: grpcServiceName || '',
      },
    };
  }

  // Multiplex
  const muxBlock = multiplex ? { multiplex: { enabled: true, padding: true } } : {};

  switch (type.toLowerCase()) {
    case 'shadowtls':
      const stlsTag = tag;
      const ssTag = detour || `${tag}-ss`;
      const ssKey = opts.ssPassword || opts.password || 'n2+xP7UC266h4wBRVp6pEg==';
      const ssMethod = opts.ssMethod || method || '2022-blake3-aes-128-gcm';
      const sni = serverName || opts.sni || 'gateway.icloud.com';
      const stlsVer = parseInt(shadowtlsVersion || opts.version || 3, 10);

      const userList = (users && users.length > 0)
        ? users.map((u) => ({
            name: u.name || u.email || 'user',
            password: u.password || shadowtlsPassword || opts.password,
          }))
        : [{
            password: shadowtlsPassword || opts.password || '06bd7e3dde5046b436be6e8553a2baef',
          }];

      const stlsInbound = {
        type: 'shadowtls',
        tag: stlsTag,
        listen: listen === '0.0.0.0' ? '::' : listen,
        listen_port: parseInt(port, 10),
        version: stlsVer,
        users: userList,
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
      };

      return [stlsInbound, ssInbound];

    case 'shadowsocks':
      return {
        ...base,
        method,
        password: password || uuidv4(),
        ...(users.length > 0
          ? { users: users.map((u) => ({ name: u.email || u.name || '', password: u.password || password })) }
          : {}),
        ...muxBlock,
      };

    case 'vless':
      return {
        ...base,
        users: users.map((u) => ({
          uuid: u.uuid || uuidv4(),
          flow: u.flow || (isReality ? 'xtls-rprx-vision' : ''),
          name: u.email || '',
        })),
        ...tlsBlock,
        ...transportBlock,
        ...muxBlock,
      };

    case 'vmess':
      return {
        ...base,
        users: users.map((u) => ({
          uuid: u.uuid || uuidv4(),
          alterId: u.alterId || 0,
          name: u.email || '',
        })),
        ...tlsBlock,
        ...transportBlock,
        ...muxBlock,
      };

    case 'trojan':
      return {
        ...base,
        users: users.map((u) => ({
          password: u.password || u.uuid || uuidv4(),
          name: u.email || '',
        })),
        ...tlsBlock,
        ...transportBlock,
        ...muxBlock,
      };

    case 'hysteria2':
      return {
        ...base,
        up_mbps: parseInt(up_mbps || 100, 10),
        down_mbps: parseInt(down_mbps || 100, 10),
        ignore_client_bandwidth: Boolean(ignoreClientBandwidth),
        ...(obfsPassword ? { obfs: { type: 'salamander', password: obfsPassword } } : {}),
        users: users.map((u) => ({
          password: u.password || uuidv4(),
          name: u.email || '',
        })),
        tls: {
          enabled: true,
          server_name: serverName || '127.0.0.1',
          certificate_path: cfg.CERT_FULLCHAIN,
          key_path: cfg.CERT_PRIVKEY,
        },
      };

    case 'tuic':
      return {
        ...base,
        users: users.map((u) => ({
          uuid: u.uuid || uuidv4(),
          password: u.password || uuidv4(),
          name: u.email || '',
        })),
        congestion_control,
        zero_rtt_handshake: Boolean(zero_rtt_handshake),
        tls: {
          enabled: true,
          server_name: serverName || '127.0.0.1',
          alpn: ['h3'],
          certificate_path: cfg.CERT_FULLCHAIN,
          key_path: cfg.CERT_PRIVKEY,
        },
      };

    case 'mixed':
    case 'socks':
      return {
        ...base,
        type: type === 'mixed' ? 'mixed' : 'socks',
        users: users.map((u) => ({
          username: u.email || '',
          password: u.password || uuidv4(),
        })),
      };

    case 'wireguard':
      return {
        ...base,
        private_key,
        peers: peers.length
          ? peers
          : [
              {
                public_key: peer_public_key,
                pre_shared_key: pre_shared_key,
                allowed_ips: ['0.0.0.0/0', '::/0'],
              },
            ],
      };

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
    publicKey = '',
    shortIds = [],
    shortId = '',
    fingerprint = 'chrome',
    alpn = ['h2', 'http/1.1'],
    // Transport
    transport = 'tcp',
    wsPath = '/',
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

  const clientList = (clients && clients.length > 0) ? clients : (opts.users || []);

  // Stream settings builder
  const buildStreamSettings = () => {
    const ss = { network: transport };

    if (transport === 'ws') {
      ss.wsSettings = {
        path: wsPath || '/',
        headers: wsHost ? { Host: wsHost } : {},
      };
    } else if (transport === 'grpc') {
      ss.grpcSettings = {
        serviceName: grpcServiceName || '',
        multiMode: true,
      };
    } else if (transport === 'httpupgrade') {
      ss.httpupgradeSettings = {
        path: wsPath || '/',
        host: wsHost || '',
      };
    } else if (transport === 'splithttp') {
      ss.splithttpSettings = {
        path: wsPath || '/',
        host: wsHost || '',
      };
    }

    if (security === 'tls') {
      ss.security = 'tls';
      ss.tlsSettings = {
        serverName: serverName || '',
        alpn: Array.isArray(alpn) ? alpn : ['h2', 'http/1.1'],
        certificates: [
          { certificateFile: cfg.CERT_FULLCHAIN, keyFile: cfg.CERT_PRIVKEY },
        ],
      };
    } else if (security === 'reality') {
      ss.security = 'reality';
      const target = dest || (serverName ? `${serverName}:443` : 'www.microsoft.com:443');
      const allServerNames = serverNames.length > 0 ? serverNames : [serverName || 'www.microsoft.com'];
      const allShortIds = shortIds.length > 0 ? shortIds : (shortId ? [shortId] : ['']);

      ss.realitySettings = {
        show: false,
        dest: target,
        xver: 0,
        serverNames: allServerNames,
        privateKey: privateKey,
        shortIds: allShortIds,
        fingerprint: fingerprint || 'chrome',
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

  switch (type.toLowerCase()) {
    case 'vless':
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'vless',
        settings: {
          clients: clientList.map((c) => ({
            id: c.uuid || uuidv4(),
            flow: c.flow || (security === 'reality' ? 'xtls-rprx-vision' : ''),
            email: c.email || '',
          })),
          decryption: 'none',
        },
        streamSettings: buildStreamSettings(),
        ...sniffBlock,
      };

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
    case 'hysteria2':
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'hysteria',
        settings: {
          clients: clientList.map((c) => ({
            auth: c.password || c.uuid || uuidv4(),
            email: c.email || '',
          })),
          version: 2,
        },
        streamSettings: {
          network: 'hysteria',
          security: 'tls',
          tlsSettings: {
            alpn: ['h3', 'h2', 'http/1.1'],
            serverName: serverName || '127.0.0.1',
            certificates: [
              { certificateFile: cfg.CERT_FULLCHAIN, keyFile: cfg.CERT_PRIVKEY },
            ],
          },
          ...(obfsPassword
            ? {
                finalmask: {
                  udp: [
                    {
                      type: 'salamander',
                      settings: { password: obfsPassword },
                    },
                  ],
                },
              }
            : {}),
        },
        ...sniffBlock,
      };

    case 'shadowsocks':
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'shadowsocks',
        settings: {
          method,
          password: password || uuidv4(),
          network: 'tcp,udp',
          clients: clientList.map((c) => ({
            password: c.password || uuidv4(),
            email: c.email || '',
            method: c.method || method,
          })),
        },
        streamSettings: { network: 'tcp', security: 'none' },
      };

    case 'socks':
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'socks',
        settings: {
          auth: 'password',
          accounts: clients.map((c) => ({
            user: c.email || '',
            pass: c.password || uuidv4(),
          })),
          udp: true,
        },
        ...sniffBlock,
      };

    case 'http':
      return {
        tag,
        listen,
        port: parseInt(port, 10),
        protocol: 'http',
        settings: {
          allowTransparent: false,
          accounts: clients.map((c) => ({
            user: c.email || '',
            pass: c.password || uuidv4(),
          })),
        },
        ...sniffBlock,
      };

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
