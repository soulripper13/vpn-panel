/**
 * utils/links.js
 * Browser-side link and configuration generator.
 */

/**
 * Generate a random UUID
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Generate a random hex password of given byte length (default 16 bytes = 32 hex chars)
 */
export function generatePassword(bytes = 16) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const generateHexPassword = generatePassword

/**
 * Generate a random base64 key of given byte length (e.g. 16 bytes for ss-2022-aes-128)
 */
export function generateBase64Key(bytes = 16) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  let binary = ''
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i])
  }
  return btoa(binary)
}

/**
 * Extract parsed settings from an inbound
 */
export function extractSettings(inbound) {
  const settings = inbound?.settings || (typeof inbound?.settings_json === 'string'
    ? JSON.parse(inbound.settings_json || '{}')
    : (inbound?.settings_json || {}))
  const streamSettings = inbound?.stream_settings || (typeof inbound?.stream_settings_json === 'string'
    ? JSON.parse(inbound.stream_settings_json || '{}')
    : (inbound?.stream_settings_json || {}))
  return { settings, streamSettings }
}

/**
 * Generate ShadowTLS + Shadowsocks share link (standard SIP002 format)
 */
export function generateShadowtlsLink({
  host,
  port,
  method = '2022-blake3-aes-128-gcm',
  ssPassword = '',
  shadowtlsPassword = '',
  sni = 'gateway.icloud.com',
  version = 3,
  remark = 'MegaFon-ShadowTLS',
}) {
  const userinfo = btoa(`${method}:${ssPassword}`)
  const pluginParam = `shadow-tls%3Bhost%3D${encodeURIComponent(sni)}%3Bpassword%3D${encodeURIComponent(shadowtlsPassword)}%3Bversion%3D${version}`
  return `ss://${userinfo}@${host}:${port}/?plugin=${pluginParam}#${encodeURIComponent(remark)}`
}

/**
 * Generate VLESS share link
 */
export function generateVlessLink({ uuid, host, port, flow, sni, fp, pbk, sid, remark }) {
  const params = new URLSearchParams()
  if (flow) params.set('flow', flow)
  params.set('type', 'tcp')
  params.set('security', 'reality')
  if (sni) params.set('sni', sni)
  if (fp) params.set('fp', fp || 'chrome')
  if (pbk) params.set('pbk', pbk)
  if (sid) params.set('sid', sid)
  return `vless://${uuid}@${host}:${port}?${params.toString()}#${encodeURIComponent(remark || 'VPN')}`
}

/**
 * Generate VMess share link (base64 JSON)
 */
export function generateVmessLink({ uuid, host, port, path = '/', tls = 'tls', remark }) {
  const config = {
    v: '2',
    ps: remark || 'VPN',
    add: host,
    port: String(port),
    id: uuid,
    aid: '0',
    scy: 'auto',
    net: 'ws',
    type: 'none',
    host,
    path,
    tls,
    sni: host,
    alpn: '',
  }
  return `vmess://${btoa(JSON.stringify(config))}`
}

/**
 * Generate Shadowsocks share link
 */
export function generateSsLink({ method, password, host, port, remark }) {
  const userInfo = btoa(`${method}:${password}`)
  return `ss://${userInfo}@${host}:${port}#${encodeURIComponent(remark || 'VPN')}`
}

/**
 * Generate Trojan share link
 */
export function generateTrojanLink({ password, host, port, sni, remark }) {
  const params = new URLSearchParams()
  params.set('security', 'tls')
  if (sni) params.set('sni', sni)
  return `trojan://${password}@${host}:${port}?${params.toString()}#${encodeURIComponent(remark || 'VPN')}`
}

/**
 * Generate Hysteria2 share link
 */
export function generateHy2Link({ password, host, port, sni, remark }) {
  const params = new URLSearchParams()
  if (sni) params.set('sni', sni)
  params.set('insecure', '1')
  return `hy2://${password}@${host}:${port}?${params.toString()}#${encodeURIComponent(remark || 'VPN')}`
}

/**
 * Generate share link based on protocol
 */
export function generateLink(protocol, config) {
  switch (protocol?.toLowerCase()) {
    case 'shadowtls':
      return generateShadowtlsLink(config)
    case 'vless':
      return generateVlessLink(config)
    case 'vmess':
      return generateVmessLink(config)
    case 'shadowsocks':
    case 'ss':
      return generateSsLink(config)
    case 'trojan':
      return generateTrojanLink(config)
    case 'hysteria2':
    case 'hy2':
    case 'hysteria':
      return generateHy2Link(config)
    default:
      return null
  }
}

/**
 * Generate OpenClash / Clash Meta YAML snippet
 */
export function generateClashYaml(inbound, client, host) {
  if (!inbound) return ''
  const remark = client?.remark || client?.email || inbound.remark || `${inbound.type}-${inbound.port}`
  const port = inbound.port
  const { settings, streamSettings } = extractSettings(inbound)
  const type = (inbound.type || '').toLowerCase()
  const protocol = (inbound.protocol || type).toLowerCase()

  if (type === 'shadowtls' || protocol === 'shadowtls') {
    const stlsPassword = client?.password || settings.shadowtlsPassword || settings.password || ''
    const sni = settings.serverName || settings.sni || 'gateway.icloud.com'
    const ssMethod = settings.ssMethod || settings.method || '2022-blake3-aes-128-gcm'
    const ssPassword = settings.ssPassword || settings.password || ''
    const version = settings.shadowtlsVersion || settings.version || 3

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
      version: ${version}`
  }

  if (type === 'vless' || protocol === 'vless') {
    const uuid = client?.uuid || ''
    const isReality = streamSettings.security === 'reality' || settings.reality
    const sni = streamSettings.serverName || settings.serverName || host
    const publicKey = streamSettings.publicKey || settings.publicKey || ''
    const shortId = streamSettings.shortId || settings.shortId || ''
    const flow = client?.flow || (isReality ? 'xtls-rprx-vision' : '')

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
    client-fingerprint: chrome`
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
    servername: "${sni}"`
  }

  if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client?.password || settings.auth || settings.password || ''
    const sni = streamSettings.serverName || settings.serverName || host
    return `proxies:
  - name: "${remark}"
    type: hysteria2
    server: ${host}
    port: ${port}
    password: "${auth}"
    sni: "${sni}"
    skip-cert-verify: true`
  }

  if (type === 'trojan' || protocol === 'trojan') {
    const password = client?.password || settings.password || ''
    const sni = streamSettings.serverName || settings.serverName || host
    return `proxies:
  - name: "${remark}"
    type: trojan
    server: ${host}
    port: ${port}
    password: "${password}"
    sni: "${sni}"
    skip-cert-verify: true`
  }

  if (type === 'shadowsocks' || protocol === 'shadowsocks') {
    const method = settings.method || 'aes-128-gcm'
    const password = client?.password || settings.password || ''
    return `proxies:
  - name: "${remark}"
    type: ss
    server: ${host}
    port: ${port}
    cipher: ${method}
    password: "${password}"`
  }

  return `# No Clash configuration available for ${type}`
}

/**
 * Generate Sing-box client JSON outbound snippet
 */
export function generateSingboxJson(inbound, client, host) {
  if (!inbound) return ''
  const remark = client?.remark || client?.email || inbound.remark || `${inbound.type}-${inbound.port}`
  const port = inbound.port
  const { settings, streamSettings } = extractSettings(inbound)
  const type = (inbound.type || '').toLowerCase()
  const protocol = (inbound.protocol || type).toLowerCase()

  if (type === 'shadowtls' || protocol === 'shadowtls') {
    const stlsPassword = client?.password || settings.shadowtlsPassword || settings.password || ''
    const sni = settings.serverName || settings.sni || 'gateway.icloud.com'
    const ssMethod = settings.ssMethod || settings.method || '2022-blake3-aes-128-gcm'
    const ssPassword = settings.ssPassword || settings.password || ''
    const version = parseInt(settings.shadowtlsVersion || settings.version || 3, 10)

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
    ]

    return JSON.stringify({ outbounds }, null, 2)
  }

  if (type === 'vless' || protocol === 'vless') {
    const uuid = client?.uuid || ''
    const isReality = streamSettings.security === 'reality' || settings.reality
    const sni = streamSettings.serverName || settings.serverName || host
    const publicKey = streamSettings.publicKey || settings.publicKey || ''
    const shortId = streamSettings.shortId || settings.shortId || ''
    const flow = client?.flow || (isReality ? 'xtls-rprx-vision' : '')

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
    ]

    return JSON.stringify({ outbounds }, null, 2)
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
  }, null, 2)
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    return true
  }
}
