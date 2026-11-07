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
 * Robust extractor for all anti-censorship parameters of Hysteria 2
 */
export function extractHysteriaDetails(inbound, settings, streamSettings, host) {
  // 1. Obfs password (Salamander)
  let obfsPassword = settings?.obfsPassword || streamSettings?.obfsPassword || ''
  if (!obfsPassword && streamSettings?.finalmask?.udp) {
    const salamander = streamSettings.finalmask.udp.find((u) => u.type === 'salamander')
    if (salamander?.settings?.password) {
      obfsPassword = salamander.settings.password
    }
  }
  if (!obfsPassword && settings?.finalmask?.udp) {
    const salamander = settings.finalmask.udp.find((u) => u.type === 'salamander')
    if (salamander?.settings?.password) {
      obfsPassword = salamander.settings.password
    }
  }

  // 2. Port hopping range & hop interval
  let ports = settings?.ports || streamSettings?.ports || settings?.udpHopPorts || streamSettings?.udpHopPorts || ''
  let hopInterval = settings?.hopInterval || streamSettings?.hopInterval || 30
  if (!ports && streamSettings?.finalmask?.quicParams?.udpHop?.ports) {
    ports = streamSettings.finalmask.quicParams.udpHop.ports
    hopInterval = streamSettings.finalmask.quicParams.udpHop.interval || 30
  }
  if (!ports && settings?.finalmask?.quicParams?.udpHop?.ports) {
    ports = settings.finalmask.quicParams.udpHop.ports
    hopInterval = settings.finalmask.quicParams.udpHop.interval || 30
  }

  // 3. SNI
  let sni = streamSettings?.tlsSettings?.serverName ||
            streamSettings?.serverName ||
            settings?.serverName ||
            settings?.sni ||
            host ||
            ''

  // 4. ALPN
  let alpn = streamSettings?.tlsSettings?.alpn || streamSettings?.alpn || ['h3']
  if (Array.isArray(alpn)) alpn = alpn[0] || 'h3'

  // 5. Insecure / Skip cert verify
  const isIpSni = /^(\d{1,3}\.){3}\d{1,3}$/.test(sni)
  const insecure = streamSettings?.insecure !== undefined
    ? Boolean(streamSettings.insecure)
    : (settings?.insecure !== undefined ? Boolean(settings.insecure) : isIpSni)

  // 6. Up / Down speed
  const upMbps = settings?.up_mbps || streamSettings?.up_mbps || 100
  const downMbps = settings?.down_mbps || streamSettings?.down_mbps || 100

  return {
    obfsPassword,
    ports,
    hopInterval,
    sni,
    alpn,
    insecure,
    upMbps,
    downMbps,
  }
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
export function generateHy2Link({ password, host, port, sni, alpn = 'h3', obfsPassword, ports, insecure = true, remark }) {
  const params = new URLSearchParams()
  if (sni) params.set('sni', sni)
  if (alpn) params.set('alpn', alpn)
  if (insecure) params.set('insecure', '1')
  if (obfsPassword) {
    params.set('obfs', 'salamander')
    params.set('obfs-password', obfsPassword)
  }
  if (ports) {
    params.set('mport', ports)
  }
  return `hy2://${password}@${host}:${port}/?${params.toString()}#${encodeURIComponent(remark || 'VPN')}`
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
    const isReality = streamSettings.security === 'reality' || settings.reality || Boolean(streamSettings.realitySettings)
    const realSettings = streamSettings.realitySettings || {}
    const sni = streamSettings.serverName || settings.serverName || (realSettings.serverNames?.[0]) || host
    const publicKey = streamSettings.publicKey || settings.publicKey || realSettings.publicKey || ''
    const shortId = streamSettings.shortId || settings.shortId || (realSettings.shortIds?.[0]) || ''
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
    const auth = client?.password || client?.auth || settings.auth || settings.password || ''
    const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host)

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
    client-fingerprint: chrome`
  }

  if (type === 'trojan' || protocol === 'trojan') {
    const password = client?.password || settings.password || ''
    const sni = streamSettings.tlsSettings?.serverName || streamSettings.serverName || settings.serverName || host
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
    const isReality = streamSettings.security === 'reality' || settings.reality || Boolean(streamSettings.realitySettings)
    const realSettings = streamSettings.realitySettings || {}
    const sni = streamSettings.serverName || settings.serverName || (realSettings.serverNames?.[0]) || host
    const publicKey = streamSettings.publicKey || settings.publicKey || realSettings.publicKey || ''
    const shortId = streamSettings.shortId || settings.shortId || (realSettings.shortIds?.[0]) || ''
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

  if (type === 'hysteria2' || protocol === 'hysteria2' || type === 'hysteria' || protocol === 'hysteria') {
    const auth = client?.password || client?.auth || settings.auth || settings.password || ''
    const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host)

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
 * Generate official Hysteria 2 client YAML (config.yaml)
 */
export function generateHysteriaCliConfig(inbound, client, host) {
  if (!inbound) return ''
  const remark = client?.remark || client?.email || inbound.remark || `${inbound.type}-${inbound.port}`
  const port = inbound.port
  const { settings, streamSettings } = extractSettings(inbound)
  const auth = client?.password || client?.auth || settings.auth || settings.password || ''
  const hy2 = extractHysteriaDetails(inbound, settings, streamSettings, host)

  const serverField = hy2.ports ? `${host}:${port},${hy2.ports}` : `${host}:${port}`

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
`
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
