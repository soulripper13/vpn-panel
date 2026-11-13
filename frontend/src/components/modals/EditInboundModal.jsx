import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  X,
  Check,
  Shield,
  Zap,
  Key,
  RefreshCw,
  Sliders,
  Network,
  Lock,
  Globe,
  Radio,
  Radar,
} from 'lucide-react'
import {
  generateUUID,
  generatePassword,
  generateHexPassword,
  generateBase64Key,
  extractSettings,
} from '../../utils/links'
import api from '../../utils/api'
import toast from 'react-hot-toast'
import Spinner from '../ui/Spinner'
import Badge from '../ui/Badge'

const ssMethods = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha8-poly1305',
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
]

const realityTargetSniPresets = [
  { sni: 'gateway.icloud.com', dest: 'gateway.icloud.com:443', label: 'Apple iCloud' },
  { sni: 'www.microsoft.com', dest: 'www.microsoft.com:443', label: 'Microsoft' },
  { sni: 'www.bing.com', dest: 'www.bing.com:443', label: 'Bing' },
  { sni: 'dl.google.com', dest: 'dl.google.com:443', label: 'Google DL' },
  { sni: 'cloudflare.com', dest: 'cloudflare.com:443', label: 'Cloudflare' },
  { sni: 'www.yahoo.com', dest: 'www.yahoo.com:443', label: 'Yahoo' },
]

export default function EditInboundModal({ isOpen, onClose, inbound, onSuccess }) {
  if (!isOpen || !inbound) return null

  const { settings: initialSettings, streamSettings: initialStream } = extractSettings(inbound)
  const protocol = (inbound.protocol || inbound.type || '').toLowerCase()
  const engine = inbound.engine || 'singbox'

  const [loading, setLoading] = useState(false)
  const [genKeyLoading, setGenKeyLoading] = useState(false)

  // 1. General Settings
  const [remark, setRemark] = useState(inbound.remark || inbound.tag || '')
  const [port, setPort] = useState(inbound.port || 2053)
  const [listen, setListen] = useState(inbound.listen || '0.0.0.0')
  const [totalTrafficLimitGb, setTotalTrafficLimitGb] = useState(
    inbound.total_bytes_limit ? Math.round(inbound.total_bytes_limit / (1024 * 1024 * 1024)) : 0
  )
  const [expiryDays, setExpiryDays] = useState(0)

  // 2. Transport
  const [transport, setTransport] = useState(initialStream.network || 'tcp')
  const [wsPath, setWsPath] = useState(initialStream.wsSettings?.path || initialStream.wsPath || '/')
  const [wsHost, setWsHost] = useState(initialStream.wsSettings?.headers?.Host || initialStream.wsHost || '')

  // 3. Security
  const isRealityInitial = initialStream.security === 'reality' || initialSettings.reality || Boolean(initialStream.realitySettings)
  const isTlsInitial = initialStream.security === 'tls' || initialSettings.tls || Boolean(initialStream.tlsSettings)
  const [security, setSecurity] = useState(isRealityInitial ? 'reality' : (isTlsInitial ? 'tls' : 'none'))

  // Reality Settings
  const realSet = initialStream.realitySettings || {}
  const [realitySni, setRealitySni] = useState(initialStream.serverName || initialSettings.serverName || realSet.serverNames?.[0] || 'gateway.icloud.com')
  const [realityDest, setRealityDest] = useState(realSet.dest || 'gateway.icloud.com:443')
  const [realityPublicKey, setRealityPublicKey] = useState(initialStream.publicKey || initialSettings.publicKey || realSet.publicKey || '')
  const [realityPrivateKey, setRealityPrivateKey] = useState(initialStream.privateKey || initialSettings.privateKey || realSet.privateKey || '')
  const [realityShortId, setRealityShortId] = useState(initialStream.shortId || initialSettings.shortId || realSet.shortIds?.[0] || '')
  const [realityFlow, setRealityFlow] = useState(initialSettings.flow || realSet.flow || 'xtls-rprx-vision')

  // Standard TLS Settings
  const [tlsSni, setTlsSni] = useState(initialStream.tlsSettings?.serverName || initialStream.serverName || initialSettings.serverName || '')
  const [tlsAlpn, setTlsAlpn] = useState(
    Array.isArray(initialStream.tlsSettings?.alpn || initialStream.alpn)
      ? (initialStream.tlsSettings?.alpn || initialStream.alpn).join(',')
      : 'h2,http/1.1'
  )

  // ShadowTLS Settings
  const [shadowtlsSni, setShadowtlsSni] = useState(initialSettings.serverName || initialSettings.sni || 'gateway.icloud.com')
  const [shadowtlsPassword, setShadowtlsPassword] = useState(initialSettings.shadowtlsPassword || initialSettings.password || '')
  const [shadowtlsVersion, setShadowtlsVersion] = useState(initialSettings.shadowtlsVersion || initialSettings.version || 3)
  const [ssMethod, setSsMethod] = useState(initialSettings.ssMethod || initialSettings.method || '2022-blake3-aes-128-gcm')
  const [ssPassword, setSsPassword] = useState(initialSettings.ssPassword || initialSettings.password || '')

  // Hysteria 2 Anti-Censorship Settings
  const [hy2Auth, setHy2Auth] = useState(initialSettings.auth || initialSettings.password || '')
  const [hy2ObfsPassword, setHy2ObfsPassword] = useState(
    initialSettings.obfsPassword || initialStream.obfsPassword || initialStream.finalmask?.udp?.[0]?.settings?.password || ''
  )
  const [hy2Ports, setHy2Ports] = useState(initialSettings.ports || initialStream.ports || '')
  const [hy2HopInterval, setHy2HopInterval] = useState(initialSettings.hopInterval || initialStream.hopInterval || 30)
  const [hy2Sni, setHy2Sni] = useState(initialStream.tlsSettings?.serverName || initialStream.serverName || initialSettings.serverName || '')
  const [hy2Insecure, setHy2Insecure] = useState(
    initialStream.insecure !== undefined ? Boolean(initialStream.insecure) : Boolean(initialSettings.insecure)
  )
  const [hy2UpMbps, setHy2UpMbps] = useState(initialSettings.up_mbps || initialStream.up_mbps || 100)
  const [hy2DownMbps, setHy2DownMbps] = useState(initialSettings.down_mbps || initialStream.down_mbps || 100)

  // Trojan / VMess / Shadowsocks Credentials
  const [generalPassword, setGeneralPassword] = useState(initialSettings.password || '')

  const handleGenerateKeypair = async () => {
    try {
      setGenKeyLoading(true)
      const res = await api.get('/inbounds/gen-keypair')
      if (res.data.success) {
        setRealityPrivateKey(res.data.data.privateKey)
        setRealityPublicKey(res.data.data.publicKey)
        toast.success('Generated new X25519 Reality keypair!')
      }
    } catch {
      toast.error('Failed to generate keypair')
    } finally {
      setGenKeyLoading(false)
    }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()

    try {
      setLoading(true)

      const payload = {
        remark,
        port: parseInt(port, 10),
        listen,
        total_bytes_limit: totalTrafficLimitGb ? parseInt(totalTrafficLimitGb, 10) * 1024 * 1024 * 1024 : 0,
        expiry_time: expiryDays ? Math.floor(Date.now() / 1000) + parseInt(expiryDays, 10) * 86400 : inbound.expiry_time || 0,
        settings: { ...initialSettings },
        stream_settings: { ...initialStream },
      }

      // 1. ShadowTLS
      if (protocol === 'shadowtls') {
        payload.settings.serverName = shadowtlsSni
        payload.settings.sni = shadowtlsSni
        payload.settings.shadowtlsPassword = shadowtlsPassword
        payload.settings.password = shadowtlsPassword
        payload.settings.version = parseInt(shadowtlsVersion, 10)
        payload.settings.ssMethod = ssMethod
        payload.settings.method = ssMethod
        payload.settings.ssPassword = ssPassword
      }

      // 2. VLESS
      if (protocol === 'vless') {
        payload.stream_settings.network = transport
        payload.stream_settings.security = security

        if (security === 'reality') {
          payload.stream_settings.serverName = realitySni
          payload.stream_settings.publicKey = realityPublicKey
          payload.stream_settings.privateKey = realityPrivateKey
          payload.stream_settings.shortId = realityShortId
          payload.stream_settings.realitySettings = {
            dest: realityDest,
            serverNames: [realitySni],
            privateKey: realityPrivateKey,
            publicKey: realityPublicKey,
            shortIds: realityShortId ? [realityShortId] : [''],
          }
          payload.settings.flow = realityFlow
        } else if (security === 'tls') {
          payload.stream_settings.serverName = tlsSni
          payload.stream_settings.tlsSettings = {
            serverName: tlsSni,
            alpn: tlsAlpn ? tlsAlpn.split(',').map((s) => s.trim()) : ['h2', 'http/1.1'],
          }
        }
      }

      // 3. Hysteria 2
      if (protocol === 'hysteria2' || protocol === 'hysteria') {
        payload.settings.auth = hy2Auth
        payload.settings.password = hy2Auth
        payload.settings.obfsPassword = hy2ObfsPassword
        payload.settings.ports = hy2Ports
        payload.settings.hopInterval = parseInt(hy2HopInterval || 30, 10)
        payload.settings.up_mbps = parseInt(hy2UpMbps || 100, 10)
        payload.settings.down_mbps = parseInt(hy2DownMbps || 100, 10)
        payload.settings.insecure = hy2Insecure

        payload.stream_settings.serverName = hy2Sni
        payload.stream_settings.insecure = hy2Insecure
        payload.stream_settings.ports = hy2Ports
        payload.stream_settings.hopInterval = parseInt(hy2HopInterval || 30, 10)
        payload.stream_settings.obfsPassword = hy2ObfsPassword
        if (hy2ObfsPassword) {
          payload.stream_settings.finalmask = {
            udp: [{ type: 'salamander', settings: { password: hy2ObfsPassword } }],
            quicParams: hy2Ports ? { udpHop: { ports: hy2Ports, interval: parseInt(hy2HopInterval || 30, 10) } } : undefined,
          }
        }
      }

      // 4. Trojan / VMess / Shadowsocks
      if (protocol === 'trojan' || protocol === 'shadowsocks') {
        payload.settings.password = generalPassword
        if (protocol === 'shadowsocks') {
          payload.settings.method = ssMethod
        }
      }

      const res = await api.put(`/inbounds/${inbound.id}`, payload)
      if (res.data.success) {
        toast.success(`Inbound ${remark} updated successfully!`)
        onSuccess()
        onClose()
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update inbound')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[92vh] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2d3148]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
              <Sliders className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-semibold text-white">Edit Inbound: {inbound.remark || inbound.tag}</h3>
                <Badge variant={engine === 'singbox' ? 'singbox' : 'xray'}>{engine}</Badge>
                <span className="text-xs font-mono font-medium text-indigo-300 uppercase">[{protocol}]</span>
              </div>
              <p className="text-xs text-slate-400">Modify listening port, camouflage SNI, and protocol security settings</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleUpdate} className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* General Inbound Parameters */}
          <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              <span>Network & General Settings</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-400 block mb-1">Remark / Display Name</label>
                <input
                  type="text"
                  required
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Port *</label>
                <input
                  type="number"
                  required
                  min="1"
                  max="65535"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Listen Address</label>
                <input
                  type="text"
                  value={listen}
                  onChange={(e) => setListen(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Traffic Limit (GB, 0=unlimited)</label>
                <input
                  type="number"
                  min="0"
                  value={totalTrafficLimitGb}
                  onChange={(e) => setTotalTrafficLimitGb(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Extend Expiry (+Days, 0=keep)</label>
                <input
                  type="number"
                  min="0"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  placeholder="0"
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* PROTOCOL-SPECIFIC CONFIGURATION */}

          {/* 1. SHADOWTLS */}
          {protocol === 'shadowtls' && (
            <div className="bg-[#14161f] border border-purple-500/30 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-semibold text-purple-300 uppercase tracking-wider flex items-center space-x-1.5">
                <Shield className="w-3.5 h-3.5 text-purple-400" />
                <span>ShadowTLS v3 & Shadowsocks Detour Parameters</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Camouflage SNI / Handshake Host</label>
                  <input
                    type="text"
                    required
                    value={shadowtlsSni}
                    onChange={(e) => setShadowtlsSni(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-slate-400">Shadow-TLS Plugin Password</label>
                    <button
                      type="button"
                      onClick={() => setShadowtlsPassword(generateHexPassword(16))}
                      className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center space-x-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Random</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={shadowtlsPassword}
                    onChange={(e) => setShadowtlsPassword(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Shadowsocks Cipher</label>
                  <select
                    value={ssMethod}
                    onChange={(e) => setSsMethod(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {ssMethods.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-slate-400">Shadowsocks Key / Password</label>
                    <button
                      type="button"
                      onClick={() => setSsPassword(generateBase64Key(16))}
                      className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center space-x-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Random Key</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={ssPassword}
                    onChange={(e) => setSsPassword(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 2. VLESS REALITY */}
          {protocol === 'vless' && (
            <div className="bg-[#14161f] border border-indigo-500/30 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center space-x-1.5">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                <span>VLESS Security & Camouflage Settings</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Security Type</label>
                  <select
                    value={security}
                    onChange={(e) => setSecurity(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="reality">Reality (Zero-Cert Camouflage)</option>
                    <option value="tls">Standard TLS (Domain Cert)</option>
                    <option value="none">None (Plaintext)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Transport Network</label>
                  <select
                    value={transport}
                    onChange={(e) => setTransport(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="tcp">TCP</option>
                    <option value="ws">WebSocket (WS)</option>
                    <option value="grpc">gRPC</option>
                  </select>
                </div>
              </div>

              {security === 'reality' && (
                <div className="space-y-3 pt-2 border-t border-[#2d3148]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-slate-400">Reality Target SNI</label>
                        <Link
                          to="/sni-finder"
                          target="_blank"
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium transition"
                        >
                          <Radar className="w-2.5 h-2.5" />
                          <span>⚡ Ideal SNI Finder</span>
                        </Link>
                      </div>
                      <input
                        type="text"
                        required
                        value={realitySni}
                        onChange={(e) => {
                          setRealitySni(e.target.value)
                          if (!realityDest || realityDest.startsWith(realitySni)) {
                            setRealityDest(`${e.target.value}:443`)
                          }
                        }}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Reality Dest (Target:Port)</label>
                      <input
                        type="text"
                        required
                        value={realityDest}
                        onChange={(e) => setRealityDest(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-slate-400">Public Key</label>
                        <button
                          type="button"
                          onClick={handleGenerateKeypair}
                          disabled={genKeyLoading}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                        >
                          {genKeyLoading ? <Spinner size="xs" /> : <RefreshCw className="w-3 h-3" />}
                          <span>Generate New Keypair</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        value={realityPublicKey}
                        onChange={(e) => setRealityPublicKey(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Private Key (Server Only)</label>
                      <input
                        type="text"
                        required
                        value={realityPrivateKey}
                        onChange={(e) => setRealityPrivateKey(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-slate-400">Short ID (Hex)</label>
                        <button
                          type="button"
                          onClick={() => setRealityShortId(generateHexPassword(8))}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Random</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={realityShortId}
                        onChange={(e) => setRealityShortId(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Flow</label>
                      <select
                        value={realityFlow}
                        onChange={(e) => setRealityFlow(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="xtls-rprx-vision">xtls-rprx-vision (Recommended)</option>
                        <option value="">none</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. HYSTERIA 2 */}
          {(protocol === 'hysteria2' || protocol === 'hysteria') && (
            <div className="bg-[#14161f] border border-amber-500/30 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-semibold text-amber-300 uppercase tracking-wider flex items-center space-x-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Hysteria 2 Anti-Censorship & UDP Hopping</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-slate-400">Auth Password</label>
                    <button
                      type="button"
                      onClick={() => setHy2Auth(generatePassword(16))}
                      className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center space-x-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Random</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={hy2Auth}
                    onChange={(e) => setHy2Auth(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-slate-400">Salamander Obfuscation Password</label>
                    <button
                      type="button"
                      onClick={() => setHy2ObfsPassword(generatePassword(16))}
                      className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center space-x-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Random</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={hy2ObfsPassword}
                    onChange={(e) => setHy2ObfsPassword(e.target.value)}
                    placeholder="Leave empty if none"
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400 block mb-1">Port Hopping Range (e.g. 20000:50000)</label>
                  <input
                    type="text"
                    value={hy2Ports}
                    onChange={(e) => setHy2Ports(e.target.value)}
                    placeholder="20000:50000"
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Hop Interval (Sec)</label>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    value={hy2HopInterval}
                    onChange={(e) => setHy2HopInterval(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">SNI Domain</label>
                  <input
                    type="text"
                    value={hy2Sni}
                    onChange={(e) => setHy2Sni(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-5">
                  <input
                    type="checkbox"
                    id="hy2Insecure"
                    checked={hy2Insecure}
                    onChange={(e) => setHy2Insecure(e.target.checked)}
                    className="rounded bg-[#1a1d27] border-[#2d3148] text-indigo-600 focus:ring-0"
                  />
                  <label htmlFor="hy2Insecure" className="text-xs text-slate-300">
                    Skip TLS Certificate Verification (insecure)
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-3 border-t border-[#2d3148] flex justify-end space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
            >
              {loading ? <Spinner size="sm" /> : <Check className="w-4 h-4" />}
              <span>Save Inbound Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
