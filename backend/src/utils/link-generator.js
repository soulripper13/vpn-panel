/**
 * utils/link-generator.js
 * Generates client configuration links (vless://, vmess://, trojan://, ss://, hy2://, tuic://),
 * OpenClash / Clash Meta YAML blocks, Sing-box client JSON blocks, and QR codes.
 */

'use strict';

const QRCode = require('qrcode');

/**
 * Encode string to base64
 */
function toBase64(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

/**
 * Safe URL encode
 */
function urlEncode(str) {
  return encodeURIComponent(str || '');
}

/**
 * Extract parsed settings and streamSettings from inbound
 */
function extractSettings(inbound) {
  const settings = inbound.settings || (typeof inbound.settings_json === 'string'
    ? JSON.parse(inbound.settings_json || '{}')
    : (inbound.settings_json || {}));
  const streamSettings = inbound.stream_settings || (typeof inbound.stream_settings_json === 'string'
    ? JSON.parse(inbound.stream_settings_json || '{}')
    : (inbound.stream_settings_json || {}));
  return { settings, streamSettings };
}

/**
 * Generate share link for a given inbound and client
 *
 * @param {object} inbound Inbound record
 * @param {object} client Client record
 * @param {string} host Server IP or hostname
 * @returns {string} Protocol URI link
 */
function generateClientLink(inbound, client, host) {
  const remark = client.remark || client.email || inbound.remark || `${inbound.type}-${inbound.port}`;
  const port = inbound.port;
  const { settings, streamSettings } = extractSettings(inbound);

  const type = (inbound.type || '').toLowerCase();
  const protocol = (inbound.protocol || type).toLowerCase();

  // 1. ShadowTLS + Shadowsocks
  if (type === 'shadowtls' || protocol === 'shadowtls') {
    const stlsPassword = client.password || settings.shadowtlsPassword || settings.password || '';
    const sni = settings.serverName || settings.sni || 'gateway.icloud.com';
    const ssMethod = settings.ssMethod || settings.method || '2022-blake3-aes-128-gcm';
    const ssPassword = settings.ssPassword || settings.password || '';
    const version = settings.shadowtlsVersion || settings.version || 3;

    const userinfo = toBase64(`${ssMethod}:${ssPassword}`);
    // Standard SIP002 shadow-tls plugin format (Shadowrocket / NekoBox / Clash Meta)
    const pluginParam = `shadow-tls%3Bhost%3D${encodeURIComponent(sni)}%3Bpassword%3D${encodeURIComponent(stlsPassword)}%3Bversion%3D${version}`;
    return `ss://${userinfo}@${host}:${port}/?plugin=${pluginParam}#${urlEncode(remark)}`;
  }

  // 2. Shadowsocks standard
  if (type === 'shadowsocks' || protocol === 'shadowsocks') {
    const method = settings.method || 'aes-128-gcm';
    const password = client.password || settings.password || '';
    const userinfo = toBase64(`${method}:${password}`);
    return `ss://${userinfo}@${host}:${port}#${urlEncode(remark)}`;
  }

  // 3. VLESS
  if (type === 'vless' || protocol === 'vless') {
    const uuid = client.uuid || '';
    const params = new URLSearchParams();

    const isReality = streamSettings.security === 'reality' || settings.reality;
    const isTls = streamSettings.security === 'tls' || settings.tls;

    params.set('type', streamSettings.network || 'tcp');

    if (isReality) {
      params.set('security', 'reality');
      params.set('pbk', streamSettings.publicKey || settings.publicKey || '');
      params.set('fp', streamSettings.fingerprint || settings.fingerprint || 'chrome');
      params.set('sni', streamSettings.serverName || settings.serverName || '');
      if (streamSettings.shortId || settings.shortId) {
        params.set('sid', streamSettings.shortId || settings.shortId);
      }
      if (client.flow) {
        params.set('flow', client.flow);
      }
    } else if (isTls) {
      params.set('security', 'tls');
      params.set('sni', streamSettings.serverName || settings.serverName || host);
      if (streamSettings.alpn) {
        params.set('alpn', Array.isArray(streamSettings.alpn) ? streamSettings.alpn.join(',') : streamSettings.alpn);
      }
    } else {
      params.set('security', 'none');
    }

    if (streamSettings.network === 'ws') {
      params.set('path', streamSettings.wsPath || '/');
      params.set('host', streamSettings.wsHost || host);
    } else if (streamSettings.network === 'grpc') {
      params.set('serviceName', streamSettings.grpcServiceName || '');
    }

    return `vless://${uuid}@${host}:${port}?${params.toString()}#${urlEncode(remark)}`;
  }

  // 4. VMess
  if (type === 'vmess' || protocol === 'vmess') {
    const uuid = client.uuid || '';
    const net = streamSettings.network || 'ws';
    const isTls = streamSettings.security === 'tls';

    const vmessConfig = {
      v: '2',
      ps: remark,
      add: host,
      port: String(port),
      id: uuid,
      aid: '0',
      scy: 'auto',
      net: net,
      type: 'none',
      host: streamSettings.wsHost || host,
      path: streamSettings.wsPath || '/',
      tls: isTls ? 'tls' : 'none',
      sni: isTls ? (streamSettings.serverName || host) : '',
      alpn: '',
    };

    return `vmess://${toBase64(JSON.stringify(vmessConfig))}`;
  }

  // 5. Trojan
  if (type === 'trojan' || protocol === 'trojan') {
    const password = client.password || settings.password || '';
    const params = new URLSearchParams();
    params.set('security', 'tls');
    params.set('sni', streamSettings.serverName || settings.serverName || host);
    params.set('type', streamSettings.network || 'tcp');

    if (streamSettings.network === 'ws') {
      params.set('path', streamSettings.wsPath || '/');
      params.set('host', streamSettings.wsHost || host);
    }

    return `trojan://${password}@${host}:${port}?${params.toString()}#${urlEncode(remark)}`;
  }

  // 6. Hysteria 2
  if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client.password || settings.auth || settings.password || '';
    const params = new URLSearchParams();
    if (streamSettings.serverName || settings.serverName) {
      params.set('sni', streamSettings.serverName || settings.serverName);
    }
    if (streamSettings.insecure || settings.insecure) {
      params.set('insecure', '1');
    }
    if (streamSettings.obfsPassword || settings.obfsPassword) {
      params.set('obfs', 'salamander');
      params.set('obfs-password', streamSettings.obfsPassword || settings.obfsPassword);
    }
    return `hy2://${auth}@${host}:${port}?${params.toString()}#${urlEncode(remark)}`;
  }

  // 7. TUIC
  if (type === 'tuic' || protocol === 'tuic') {
    const uuid = client.uuid || '';
    const password = client.password || '';
    const params = new URLSearchParams();
    params.set('congestion_control', settings.congestion_control || 'bbr');
    if (streamSettings.serverName || settings.serverName) {
      params.set('sni', streamSettings.serverName || settings.serverName);
    }
    params.set('alpn', 'h3');
    return `tuic://${uuid}:${password}@${host}:${port}?${params.toString()}#${urlEncode(remark)}`;
  }

  // Fallback generic
  return `vpn://${host}:${port}#${urlEncode(remark)}`;
}

/**
 * Generate OpenClash / Clash Meta YAML proxy block
 */
function generateClashConfig(inbound, client, host) {
  const remark = client.remark || client.email || inbound.remark || `${inbound.type}-${inbound.port}`;
  const port = inbound.port;
  const { settings, streamSettings } = extractSettings(inbound);
  const type = (inbound.type || '').toLowerCase();
  const protocol = (inbound.protocol || type).toLowerCase();

  // ShadowTLS
  if (type === 'shadowtls' || protocol === 'shadowtls') {
    const stlsPassword = client.password || settings.shadowtlsPassword || settings.password || '';
    const sni = settings.serverName || settings.sni || 'gateway.icloud.com';
    const ssMethod = settings.ssMethod || settings.method || '2022-blake3-aes-128-gcm';
    const ssPassword = settings.ssPassword || settings.password || '';
    const version = settings.shadowtlsVersion || settings.version || 3;

    return `proxies:
  - name: "${remark}"
    type: ss
    server: ${host}
    port: ${port}
    cipher: ${ssMethod}
    password: "${ssPassword}"
    plugin: shadow-tls
    client-fingerprint: chrome
    plugin-opts:
      host: "${sni}"
      password: "${stlsPassword}"
      version: ${version}`;
  }

  // VLESS Reality
  if (type === 'vless' || protocol === 'vless') {
    const uuid = client.uuid || '';
    const isReality = streamSettings.security === 'reality' || settings.reality;
    const sni = streamSettings.serverName || settings.serverName || host;
    const publicKey = streamSettings.publicKey || settings.publicKey || '';
    const shortId = streamSettings.shortId || settings.shortId || '';
    const flow = client.flow || (isReality ? 'xtls-rprx-vision' : '');

    if (isReality) {
      return `proxies:
  - name: "${remark}"
    type: vless
    server: ${host}
    port: ${port}
    uuid: "${uuid}"
    network: tcp
    tls: true
    udp: true
    flow: ${flow}
    servername: "${sni}"
    reality-opts:
      public-key: "${publicKey}"
      short-id: "${shortId}"
    client-fingerprint: chrome`;
    }

    return `proxies:
  - name: "${remark}"
    type: vless
    server: ${host}
    port: ${port}
    uuid: "${uuid}"
    network: ${streamSettings.network || 'tcp'}
    tls: ${streamSettings.security === 'tls'}
    udp: true
    servername: "${sni}"`;
  }

  // Hysteria 2
  if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client.password || settings.auth || settings.password || '';
    const sni = streamSettings.serverName || settings.serverName || host;
    return `proxies:
  - name: "${remark}"
    type: hysteria2
    server: ${host}
    port: ${port}
    password: "${auth}"
    sni: "${sni}"
    skip-cert-verify: true`;
  }

  // Trojan
  if (type === 'trojan' || protocol === 'trojan') {
    const password = client.password || settings.password || '';
    const sni = streamSettings.serverName || settings.serverName || host;
    return `proxies:
  - name: "${remark}"
    type: trojan
    server: ${host}
    port: ${port}
    password: "${password}"
    sni: "${sni}"
    skip-cert-verify: true`;
  }

  // Shadowsocks
  if (type === 'shadowsocks' || protocol === 'shadowsocks') {
    const method = settings.method || 'aes-128-gcm';
    const password = client.password || settings.password || '';
    return `proxies:
  - name: "${remark}"
    type: ss
    server: ${host}
    port: ${port}
    cipher: ${method}
    password: "${password}"`;
  }

  return `# No Clash configuration available for ${type}`;
}

/**
 * Generate Sing-box client JSON outbounds
 */
function generateSingboxConfig(inbound, client, host) {
  const remark = client.remark || client.email || inbound.remark || `${inbound.type}-${inbound.port}`;
  const port = inbound.port;
  const { settings, streamSettings } = extractSettings(inbound);
  const type = (inbound.type || '').toLowerCase();
  const protocol = (inbound.protocol || type).toLowerCase();

  // ShadowTLS
  if (type === 'shadowtls' || protocol === 'shadowtls') {
    const stlsPassword = client.password || settings.shadowtlsPassword || settings.password || '';
    const sni = settings.serverName || settings.sni || 'gateway.icloud.com';
    const ssMethod = settings.ssMethod || settings.method || '2022-blake3-aes-128-gcm';
    const ssPassword = settings.ssPassword || settings.password || '';
    const version = parseInt(settings.shadowtlsVersion || settings.version || 3, 10);

    const outbounds = [
      {
        type: 'shadowtls',
        tag: `${remark}-shadowtls`,
        server: host,
        server_port: port,
        version: version,
        password: stlsPassword,
        tls: {
          enabled: true,
          server_name: sni,
          utls: {
            enabled: true,
            fingerprint: 'chrome',
          },
        },
        detour: `${remark}-ss`,
      },
      {
        type: 'shadowsocks',
        tag: `${remark}-ss`,
        server: host,
        server_port: port,
        method: ssMethod,
        password: ssPassword,
      },
    ];

    return JSON.stringify({ outbounds }, null, 2);
  }

  // VLESS Reality
  if (type === 'vless' || protocol === 'vless') {
    const uuid = client.uuid || '';
    const isReality = streamSettings.security === 'reality' || settings.reality;
    const sni = streamSettings.serverName || settings.serverName || host;
    const publicKey = streamSettings.publicKey || settings.publicKey || '';
    const shortId = streamSettings.shortId || settings.shortId || '';
    const flow = client.flow || (isReality ? 'xtls-rprx-vision' : '');

    const outbounds = [
      {
        type: 'vless',
        tag: remark,
        server: host,
        server_port: port,
        uuid: uuid,
        flow: flow,
        network: 'tcp',
        tls: {
          enabled: true,
          server_name: sni,
          reality: isReality ? {
            enabled: true,
            public_key: publicKey,
            short_id: shortId,
          } : undefined,
          utls: {
            enabled: true,
            fingerprint: 'chrome',
          },
        },
      },
    ];

    return JSON.stringify({ outbounds }, null, 2);
  }

  return JSON.stringify({
    outbounds: [
      {
        type: type,
        tag: remark,
        server: host,
        server_port: port,
      },
    ],
  }, null, 2);
}

/**
 * Generate QR code as data URL (Base64 PNG image)
 *
 * @param {string} text Link text
 * @returns {Promise<string>} Data URL
 */
async function generateQRCode(text) {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  } catch (err) {
    throw new Error(`Failed to generate QR code: ${err.message}`);
  }
}

module.exports = {
  generateClientLink,
  generateClashConfig,
  generateSingboxConfig,
  generateQRCode,
};
