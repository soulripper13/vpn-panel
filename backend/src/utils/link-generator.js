/**
 * utils/link-generator.js
 * Generates client configuration links (vless://, vmess://, trojan://, ss://, hy2://, tuic://),
 * OpenClash / Clash Meta YAML blocks, Sing-box client JSON blocks, and QR codes.
 */

'use strict';

const QRCode = require('qrcode');
const yaml = require('js-yaml');

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

  // 5. Insecure / Skip cert verify (default to false, H4)
  const insecure = streamSettings.insecure !== undefined
    ? Boolean(streamSettings.insecure)
    : (settings.insecure !== undefined ? Boolean(settings.insecure) : false);

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

  // 1. ShadowTLS + Shadowsocks (or shadowsocks with shadow-tls plugin)
  const isStls = type === 'shadowtls' || protocol === 'shadowtls' || settings.plugin === 'shadow-tls' || Boolean(settings.shadowtlsPassword);
  if (isStls) {
    const stlsPassword = client.password || settings.shadowtlsPassword || settings.password || '';
    const sni = settings.serverName || settings.sni || 'gateway.icloud.com';
    const ssMethod = settings.ssMethod || settings.method || '2022-blake3-aes-128-gcm';
    const ssPassword = settings.ssPassword || settings.password || '';
    const version = settings.shadowtlsVersion || settings.version || 3;

    const userinfo = toBase64(`${ssMethod}:${ssPassword}`);
    // Standard SIP002 shadow-tls plugin format (Shadowrocket / NekoBox / Clash Meta)
    // Note: NEVER include a slash between port and ?plugin=, as Shadowrocket regex requires ss://user:pass@host:port?plugin=...
    const pluginParam = `shadow-tls%3Bhost%3D${encodeURIComponent(sni)}%3Bpassword%3D${encodeURIComponent(stlsPassword)}%3Bversion%3D${version}`;
    return `ss://${userinfo}@${host}:${port}?plugin=${pluginParam}#${urlEncode(remark)}`;
  }

  // 2. Shadowsocks standard or generic plugin
  if (type === 'shadowsocks' || protocol === 'shadowsocks') {
    const method = settings.method || 'aes-128-gcm';
    const password = client.password || settings.password || '';
    const userinfo = toBase64(`${method}:${password}`);
    if (settings.plugin) {
      let pluginParam = encodeURIComponent(settings.plugin);
      if (settings.pluginOpts) {
        pluginParam += `%3B${encodeURIComponent(settings.pluginOpts)}`;
      }
      return `ss://${userinfo}@${host}:${port}?plugin=${pluginParam}#${urlEncode(remark)}`;
    }
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
 * Generate OpenClash / Clash Meta proxy object { name, yaml }
 */
function generateClashProxy(inbound, client, host) {
  const remark = client.remark || client.email || inbound.remark || `${inbound.type}-${inbound.port}`;
  const port = inbound.port;
  const { settings, streamSettings } = extractSettings(inbound);
  const type = (inbound.type || '').toLowerCase();
  const protocol = (inbound.protocol || type).toLowerCase();
  let proxyObj = null;

  // ShadowTLS (or Shadowsocks + shadow-tls plugin)
  if (type === 'shadowtls' || protocol === 'shadowtls' || settings.plugin === 'shadow-tls' || Boolean(settings.shadowtlsPassword)) {
    const stlsPassword = client.password || settings.shadowtlsPassword || settings.password || '';
    const sni = settings.serverName || settings.sni || 'gateway.icloud.com';
    const ssMethod = settings.ssMethod || settings.method || '2022-blake3-aes-128-gcm';
    const ssPassword = settings.ssPassword || settings.password || '';
    const version = settings.shadowtlsVersion || settings.version || 3;

    proxyObj = {
      name: remark,
      type: 'ss',
      server: host,
      port,
      cipher: ssMethod,
      password: ssPassword,
      plugin: 'shadow-tls',
      'client-fingerprint': 'chrome',
      'plugin-opts': {
        host: sni,
        password: stlsPassword,
        version,
      },
    };
  }

  // VLESS Reality
  else if (type === 'vless' || protocol === 'vless') {
    const uuid = client.uuid || '';
    const isReality = streamSettings.security === 'reality' || settings.reality || Boolean(streamSettings.realitySettings);
    const realSettings = streamSettings.realitySettings || {};
    const sni = streamSettings.serverName || settings.serverName || (realSettings.serverNames?.[0]) || host;
    const publicKey = streamSettings.publicKey || settings.publicKey || realSettings.publicKey || '';
    const shortId = streamSettings.shortId || settings.shortId || (realSettings.shortIds?.[0]) || '';
    const flow = client.flow || (isReality ? 'xtls-rprx-vision' : '');

    if (isReality) {
      proxyObj = {
        name: remark,
        type: 'vless',
        server: host,
        port,
        uuid,
        network: 'tcp',
        tls: true,
        udp: true,
        flow,
        servername: sni,
        'reality-opts': {
          'public-key': publicKey,
          'short-id': shortId,
        },
        'client-fingerprint': 'chrome',
      };
    } else {
      proxyObj = {
        name: remark,
        type: 'vless',
        server: host,
        port,
        uuid,
        network: streamSettings.network || 'tcp',
        tls: streamSettings.security === 'tls',
        udp: true,
        servername: sni,
      };
    }
  }

  // Hysteria 2 (Full anti-censorship parameters for Clash Meta / Mihomo)
  else if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client.password || client.auth || settings.auth || settings.password || '';
    const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host);

    proxyObj = {
      name: remark,
      type: 'hysteria2',
      server: host,
      port,
      password: auth,
      sni: hy2.sni,
      alpn: [hy2.alpn],
      'skip-cert-verify': hy2.insecure, // Defaults to false (H4)
      up: `${hy2.upMbps} Mbps`,
      down: `${hy2.downMbps} Mbps`,
      'client-fingerprint': 'chrome',
    };

    if (hy2.ports) {
      proxyObj.ports = hy2.ports;
      proxyObj['hop-interval'] = hy2.hopInterval || 30;
    }
    if (hy2.obfsPassword) {
      proxyObj.obfs = 'salamander';
      proxyObj['obfs-password'] = hy2.obfsPassword;
    }
  }

  // Trojan
  else if (type === 'trojan' || protocol === 'trojan') {
    const password = client.password || settings.password || '';
    const sni = streamSettings.tlsSettings?.serverName || streamSettings.serverName || settings.serverName || host;
    const net = streamSettings.network || 'tcp';
    // Default to certificate verification (H4)
    const insecure = Boolean(streamSettings.tlsSettings?.allowInsecure || streamSettings.allowInsecure || settings.allowInsecure || false);

    proxyObj = {
      name: remark,
      type: 'trojan',
      server: host,
      port,
      password,
      udp: true,
      sni,
      'skip-cert-verify': insecure,
    };

    if (net === 'ws') {
      const wsPath = streamSettings.wsSettings?.path || streamSettings.wsPath || '/';
      const wsHost = streamSettings.wsSettings?.headers?.Host || streamSettings.wsHost || host;
      proxyObj.network = 'ws';
      proxyObj['ws-opts'] = {
        path: wsPath,
        headers: { Host: wsHost },
      };
    }
  }

  // Shadowsocks
  else if (type === 'shadowsocks' || protocol === 'shadowsocks') {
    const method = settings.method || 'aes-128-gcm';
    const password = client.password || settings.password || '';
    proxyObj = {
      name: remark,
      type: 'ss',
      server: host,
      port,
      cipher: method,
      password,
    };
  }

  // VMess
  else if (type === 'vmess' || protocol === 'vmess') {
    const uuid = client.uuid || '';
    const isTls = streamSettings.security === 'tls';
    const sni = isTls ? (streamSettings.tlsSettings?.serverName || streamSettings.serverName || host) : '';
    const net = streamSettings.network || 'ws';
    const wsPath = streamSettings.wsSettings?.path || streamSettings.wsPath || '/';
    const wsHost = streamSettings.wsSettings?.headers?.Host || streamSettings.wsHost || host;

    proxyObj = {
      name: remark,
      type: 'vmess',
      server: host,
      port,
      uuid,
      alterId: 0,
      cipher: 'auto',
      udp: true,
    };

    if (isTls) {
      proxyObj.tls = true;
      proxyObj.servername = sni;
      proxyObj['skip-cert-verify'] = Boolean(streamSettings.tlsSettings?.allowInsecure || false);
    }
    if (net === 'ws') {
      proxyObj.network = 'ws';
      proxyObj['ws-opts'] = {
        path: wsPath,
        headers: { Host: wsHost },
      };
    } else if (net === 'grpc') {
      const serviceName = streamSettings.grpcSettings?.serviceName || streamSettings.grpcServiceName || '';
      proxyObj.network = 'grpc';
      proxyObj['grpc-opts'] = {
        'grpc-service-name': serviceName,
      };
    }
  }

  if (!proxyObj) return null;

  // Dump proxy object into YAML block safely with js-yaml (M2)
  const dumpedYaml = yaml.dump([proxyObj], { indent: 2, lineWidth: -1, noRefs: true });

  return {
    name: remark,
    obj: proxyObj,
    yaml: dumpedYaml.trim(),
  };
}

/**
 * Generate OpenClash / Clash Meta YAML proxy block
 */
function generateClashConfig(inbound, client, host) {
  const proxy = generateClashProxy(inbound, client, host);
  if (!proxy) {
    return `# No Clash configuration available for ${inbound.type || 'unknown'}`;
  }
  return `proxies:\n${proxy.yaml}`;
}

/**
 * Generate complete Clash Meta / Shadowrocket unified subscription profile safely (M2)
 */
function generateClashSubscription(proxies, profileName = 'VPN') {
  if (!proxies || proxies.length === 0) {
    return `# Empty subscription\nproxies: []`;
  }

  const proxyObjects = proxies.map((p) => p.obj || (p.yaml ? yaml.load(p.yaml)?.[0] : null)).filter(Boolean);
  const proxyNames = proxyObjects.map((p) => p.name);

  const doc = {
    port: 7890,
    'socks-port': 7891,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    'unified-delay': true,
    proxies: proxyObjects,
    'proxy-groups': [
      {
        name: 'PROXY',
        type: 'select',
        proxies: [...proxyNames, 'AUTO'],
      },
      {
        name: 'AUTO',
        type: 'url-test',
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
        tolerance: 50,
        proxies: [...proxyNames],
      },
    ],
    rules: [
      'GEOIP,LAN,DIRECT',
      'MATCH,PROXY',
    ],
  };

  return `# Clash Meta / Shadowrocket Unified Subscription Profile (${profileName})\n` + yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
}

/**
 * Generate complete Sing-box client JSON subscription
 */
function generateSingboxSubscription(items, host) {
  const allOutbounds = [];

  for (const item of items) {
    const raw = generateSingboxConfig(item.inbound, item.client, host);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.outbounds)) {
        for (const ob of parsed.outbounds) {
          allOutbounds.push(ob);
        }
      }
    } catch {
      // ignore
    }
  }

  if (!allOutbounds.some((o) => o.type === 'direct')) {
    allOutbounds.push({ type: 'direct', tag: 'direct' });
  }
  if (!allOutbounds.some((o) => o.type === 'block')) {
    allOutbounds.push({ type: 'block', tag: 'block' });
  }
  if (!allOutbounds.some((o) => o.type === 'dns')) {
    allOutbounds.push({ type: 'dns', tag: 'dns-out' });
  }

  return JSON.stringify({
    log: {
      level: 'info',
      timestamp: true,
    },
    outbounds: allOutbounds,
  }, null, 2);
}

/**
 * Generate Base64 subscription (newline-separated protocol links)
 */
function generateBase64Subscription(items, host) {
  const links = items
    .map((item) => generateClientLink(item.inbound, item.client, host))
    .filter(Boolean);
  return Buffer.from(links.join('\n'), 'utf-8').toString('base64');
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

  // ShadowTLS (or Shadowsocks + shadow-tls plugin)
  if (type === 'shadowtls' || protocol === 'shadowtls' || settings.plugin === 'shadow-tls' || Boolean(settings.shadowtlsPassword)) {
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

/**
 * Generate QR code as PNG image buffer
 *
 * @param {string} text Link text
 * @returns {Promise<Buffer>} PNG Buffer
 */
async function generateQRCodeBuffer(text) {
  try {
    return await QRCode.toBuffer(text, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  } catch (err) {
    throw new Error(`Failed to generate QR code buffer: ${err.message}`);
  }
}

module.exports = {
  extractHysteriaDetails,
  generateClientLink,
  generateClashProxy,
  generateClashConfig,
  generateClashSubscription,
  generateSingboxConfig,
  generateSingboxSubscription,
  generateBase64Subscription,
  generateHysteriaCliConfig,
  generateQRCode,
  generateQRCodeBuffer,
};
