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
 * Robust extractor for all anti-censorship parameters of Hysteria 2
 */
function extractHysteriaDetails(inbound, settings, streamSettings, host) {
  // 1. Obfs password (Salamander)
  let obfsPassword = settings.obfsPassword || streamSettings.obfsPassword || '';
  if (!obfsPassword && streamSettings.finalmask?.udp) {
    const salamander = streamSettings.finalmask.udp.find((u) => u.type === 'salamander');
    if (salamander?.settings?.password) {
      obfsPassword = salamander.settings.password;
    }
  }
  if (!obfsPassword && settings.finalmask?.udp) {
    const salamander = settings.finalmask.udp.find((u) => u.type === 'salamander');
    if (salamander?.settings?.password) {
      obfsPassword = salamander.settings.password;
    }
  }

  // 2. Port hopping range & hop interval
  let ports = settings.ports || streamSettings.ports || settings.udpHopPorts || streamSettings.udpHopPorts || '';
  let hopInterval = settings.hopInterval || streamSettings.hopInterval || 30;
  if (!ports && streamSettings.finalmask?.quicParams?.udpHop?.ports) {
    ports = streamSettings.finalmask.quicParams.udpHop.ports;
    hopInterval = streamSettings.finalmask.quicParams.udpHop.interval || 30;
  }
  if (!ports && settings.finalmask?.quicParams?.udpHop?.ports) {
    ports = settings.finalmask.quicParams.udpHop.ports;
    hopInterval = settings.finalmask.quicParams.udpHop.interval || 30;
  }

  // 3. SNI
  let sni = streamSettings.tlsSettings?.serverName ||
            streamSettings.serverName ||
            settings.serverName ||
            settings.sni ||
            host ||
            '';

  // 4. ALPN
  let alpn = streamSettings.tlsSettings?.alpn || streamSettings.alpn || ['h3'];
  if (Array.isArray(alpn)) alpn = alpn[0] || 'h3';

  // 5. Insecure / Skip cert verify
  const isIpSni = /^(\d{1,3}\.){3}\d{1,3}$/.test(sni);
  const insecure = streamSettings.insecure !== undefined
    ? Boolean(streamSettings.insecure)
    : (settings.insecure !== undefined ? Boolean(settings.insecure) : isIpSni);

  // 6. Up / Down speed
  const upMbps = settings.up_mbps || streamSettings.up_mbps || 100;
  const downMbps = settings.down_mbps || streamSettings.down_mbps || 100;

  return {
    obfsPassword,
    ports,
    hopInterval,
    sni,
    alpn,
    insecure,
    upMbps,
    downMbps,
  };
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

    const isReality = streamSettings.security === 'reality' || settings.reality || Boolean(streamSettings.realitySettings);
    const isTls = streamSettings.security === 'tls' || settings.tls || Boolean(streamSettings.tlsSettings);

    params.set('type', streamSettings.network || 'tcp');

    if (isReality) {
      const realSettings = streamSettings.realitySettings || {};
      params.set('security', 'reality');
      params.set('pbk', streamSettings.publicKey || settings.publicKey || realSettings.publicKey || '');
      params.set('fp', streamSettings.fingerprint || settings.fingerprint || realSettings.fingerprint || 'chrome');
      params.set('sni', streamSettings.serverName || settings.serverName || (realSettings.serverNames?.[0]) || '');
      const sId = streamSettings.shortId || settings.shortId || (realSettings.shortIds?.[0]) || '';
      if (sId) {
        params.set('sid', sId);
      }
      if (client.flow) {
        params.set('flow', client.flow);
      }
    } else if (isTls) {
      params.set('security', 'tls');
      params.set('sni', streamSettings.tlsSettings?.serverName || streamSettings.serverName || settings.serverName || host);
      const alpnVal = streamSettings.tlsSettings?.alpn || streamSettings.alpn;
      if (alpnVal) {
        params.set('alpn', Array.isArray(alpnVal) ? alpnVal.join(',') : alpnVal);
      }
    } else {
      params.set('security', 'none');
    }

    if (streamSettings.network === 'ws') {
      params.set('path', streamSettings.wsSettings?.path || streamSettings.wsPath || '/');
      params.set('host', streamSettings.wsSettings?.headers?.Host || streamSettings.wsHost || host);
    } else if (streamSettings.network === 'grpc') {
      params.set('serviceName', streamSettings.grpcSettings?.serviceName || streamSettings.grpcServiceName || '');
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
      host: streamSettings.wsSettings?.headers?.Host || streamSettings.wsHost || host,
      path: streamSettings.wsSettings?.path || streamSettings.wsPath || '/',
      tls: isTls ? 'tls' : 'none',
      sni: isTls ? (streamSettings.tlsSettings?.serverName || streamSettings.serverName || host) : '',
      alpn: '',
    };

    return `vmess://${toBase64(JSON.stringify(vmessConfig))}`;
  }

  // 5. Trojan
  if (type === 'trojan' || protocol === 'trojan') {
    const password = client.password || settings.password || '';
    const params = new URLSearchParams();
    params.set('security', 'tls');
    params.set('sni', streamSettings.tlsSettings?.serverName || streamSettings.serverName || settings.serverName || host);
    params.set('type', streamSettings.network || 'tcp');

    if (streamSettings.network === 'ws') {
      params.set('path', streamSettings.wsSettings?.path || streamSettings.wsPath || '/');
      params.set('host', streamSettings.wsSettings?.headers?.Host || streamSettings.wsHost || host);
    }

    return `trojan://${password}@${host}:${port}?${params.toString()}#${urlEncode(remark)}`;
  }

  // 6. Hysteria 2 (Full anti-censorship parameters for Russia/China)
  if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client.password || client.auth || settings.auth || settings.password || '';
    const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host);
    const params = new URLSearchParams();

    if (hy2.sni) params.set('sni', hy2.sni);
    if (hy2.alpn) params.set('alpn', hy2.alpn);
    if (hy2.insecure) params.set('insecure', '1');
    if (hy2.obfsPassword) {
      params.set('obfs', 'salamander');
      params.set('obfs-password', hy2.obfsPassword);
    }
    if (hy2.ports) {
      params.set('mport', hy2.ports);
    }

    return `hy2://${auth}@${host}:${port}/?${params.toString()}#${urlEncode(remark)}`;
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
    const isReality = streamSettings.security === 'reality' || settings.reality || Boolean(streamSettings.realitySettings);
    const realSettings = streamSettings.realitySettings || {};
    const sni = streamSettings.serverName || settings.serverName || (realSettings.serverNames?.[0]) || host;
    const publicKey = streamSettings.publicKey || settings.publicKey || realSettings.publicKey || '';
    const shortId = streamSettings.shortId || settings.shortId || (realSettings.shortIds?.[0]) || '';
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

  // Hysteria 2 (Full anti-censorship parameters for Clash Meta / Mihomo)
  if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client.password || client.auth || settings.auth || settings.password || '';
    const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host);

    return `proxies:
  - name: "${remark}"
    type: hysteria2
    server: ${host}
    port: ${port}${hy2.ports ? `\n    ports: "${hy2.ports}"\n    hop-interval: ${hy2.hopInterval || 30}` : ''}
    password: "${auth}"
    sni: "${hy2.sni}"
    alpn:
      - ${hy2.alpn}
    skip-cert-verify: ${hy2.insecure ? 'true' : 'false'}${hy2.obfsPassword ? `\n    obfs: salamander\n    obfs-password: "${hy2.obfsPassword}"` : ''}
    up: "${hy2.upMbps} Mbps"
    down: "${hy2.downMbps} Mbps"
    client-fingerprint: chrome`;
  }

  // Trojan
  if (type === 'trojan' || protocol === 'trojan') {
    const password = client.password || settings.password || '';
    const sni = streamSettings.tlsSettings?.serverName || streamSettings.serverName || settings.serverName || host;
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
    const isReality = streamSettings.security === 'reality' || settings.reality || Boolean(streamSettings.realitySettings);
    const realSettings = streamSettings.realitySettings || {};
    const sni = streamSettings.serverName || settings.serverName || (realSettings.serverNames?.[0]) || host;
    const publicKey = streamSettings.publicKey || settings.publicKey || realSettings.publicKey || '';
    const shortId = streamSettings.shortId || settings.shortId || (realSettings.shortIds?.[0]) || '';
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

  // Hysteria 2
  if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client.password || client.auth || settings.auth || settings.password || '';
    const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host);

    const outbounds = [
      {
        type: 'hysteria2',
        tag: remark,
        server: host,
        server_port: port,
        ...(hy2.ports ? { server_ports: hy2.ports, hop_interval: `${hy2.hopInterval || 30}s` } : {}),
        up_mbps: hy2.upMbps || 100,
        down_mbps: hy2.downMbps || 100,
        password: auth,
        ...(hy2.obfsPassword ? { obfs: { type: 'salamander', password: hy2.obfsPassword } } : {}),
        tls: {
          enabled: true,
          server_name: hy2.sni,
          alpn: [hy2.alpn || 'h3'],
          insecure: Boolean(hy2.insecure),
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
 * Generate official Hysteria 2 client YAML (config.yaml)
 */
function generateHysteriaCliConfig(inbound, client, host) {
  const remark = client.remark || client.email || inbound.remark || `${inbound.type}-${inbound.port}`;
  const port = inbound.port;
  const { settings, streamSettings } = extractSettings(inbound);
  const auth = client.password || client.auth || settings.auth || settings.password || '';
  const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host);

  const serverField = hy2.ports ? `${host}:${port},${hy2.ports}` : `${host}:${port}`;

  return `# Official Hysteria 2 Client Configuration (${remark})
server: ${serverField}
auth: "${auth}"

tls:
  sni: "${hy2.sni}"
  insecure: ${hy2.insecure ? 'true' : 'false'}
  alpn:
    - "${hy2.alpn}"

${hy2.obfsPassword ? `obfs:
  type: salamander
  salamander:
    password: "${hy2.obfsPassword}"` : '# obfs: none'}

bandwidth:
  up: ${hy2.upMbps} mbps
  down: ${hy2.downMbps} mbps

quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnectionReceiveWindow: 20971520
  maxConnectionReceiveWindow: 20971520

fastOpen: true
lazy: true
`;
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
  extractHysteriaDetails,
  generateClientLink,
  generateClashConfig,
  generateSingboxConfig,
  generateHysteriaCliConfig,
  generateQRCode,
};
