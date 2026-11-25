import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  X,
  Check,
  Shield,
  Zap,
  RefreshCw,
  Sliders,
  Radio,
  Radar,
} from 'lucide-react'
import {
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

export default function EditInboundModal({ isOpen, onClose, inbound, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [genKeyLoading, setGenKeyLoading] = useState(false)

  // 1. General Settings
  const [remark, setRemark] = useState('')
  const [port, setPort] = useState(2053)
  const [listen, setListen] = useState('0.0.0.0')
  const [totalTrafficLimitGb, setTotalTrafficLimitGb] = useState(0)
  const [expiryDays, setExpiryDays] = useState(0)

  // 2. Transport
  const [transport, setTransport] = useState('tcp')
  const [wsPath, setWsPath] = useState('/')
  const [wsHost, setWsHost] = useState('')
  const [grpcServiceName, setGrpcServiceName] = useState('grpc')

  // 3. Security
  const [security, setSecurity] = useState('none')

  // Reality Settings
  const [realitySni, setRealitySni] = useState('gateway.icloud.com')
  const [realityDest, setRealityDest] = useState('gateway.icloud.com:443')
  const [realityPublicKey, setRealityPublicKey] = useState('')
  const [realityPrivateKey, setRealityPrivateKey] = useState('')
  const [realityShortId, setRealityShortId] = useState('')
  const [realityFlow, setRealityFlow] = useState('xtls-rprx-vision')

  // Standard TLS Settings
  const [tlsSni, setTlsSni] = useState('')
  const [tlsAlpn, setTlsAlpn] = useState('h2,http/1.1')
  const [tlsInsecure, setTlsInsecure] = useState(false)
  const [certMode, setCertMode] = useState('selfsigned')
  const [certificateFile, setCertificateFile] = useState('')
  const [keyFile, setKeyFile] = useState('')

  // ShadowTLS Settings
  const [shadowtlsSni, setShadowtlsSni] = useState('gateway.icloud.com')
  const [shadowtlsPassword, setShadowtlsPassword] = useState('')
  const [shadowtlsVersion, setShadowtlsVersion] = useState(3)
  const [ssMethod, setSsMethod] = useState('2022-blake3-aes-128-gcm')
  const [ssPassword, setSsPassword] = useState('')

  // Hysteria 2 Anti-Censorship Settings
  const [hy2Auth, setHy2Auth] = useState('')
  const [hy2ObfsPassword, setHy2ObfsPassword] = useState('')
  const [hy2Ports, setHy2Ports] = useState('')
  const [hy2HopInterval, setHy2HopInterval] = useState('5-10')
  const [hy2Sni, setHy2Sni] = useState('gateway.icloud.com')
  const [hy2Insecure, setHy2Insecure] = useState(true)
  const [hy2UpMbps, setHy2UpMbps] = useState(100)
  const [hy2DownMbps, setHy2DownMbps] = useState(100)

  // Trojan / VMess / Shadowsocks / TUIC
  const [generalPassword, setGeneralPassword] = useState('')
  const [tuicCongestion, setTuicCongestion] = useState('bbr')

  useEffect(() => {
    if (!isOpen || !inbound) return

    const { settings: initSet, streamSettings: initStream } = extractSettings(inbound)
    const isRealityInit = initStream.security === 'reality' || initSet.reality || Boolean(initStream.realitySettings)
    const isTlsInit = initStream.security === 'tls' || initSet.tls || Boolean(initStream.tlsSettings)
    const realSet = initStream.realitySettings || {}

    setRemark(inbound.remark || inbound.tag || '')
    setPort(inbound.port || 2053)
    setListen(inbound.listen || '0.0.0.0')
    setTotalTrafficLimitGb(
      inbound.total_bytes_limit ? Math.round(inbound.total_bytes_limit / (1024 * 1024 * 1024)) : 0
    )
    setExpiryDays(0)

    setTransport(initStream.network || 'tcp')
    setWsPath(initStream.wsSettings?.path || initStream.wsPath || '/')
    setWsHost(initStream.wsSettings?.headers?.Host || initStream.wsHost || '')
    setGrpcServiceName(initStream.grpcSettings?.serviceName || initStream.grpcServiceName || 'grpc')

    setSecurity(isRealityInit ? 'reality' : (isTlsInit ? 'tls' : 'none'))

    setRealitySni(initStream.serverName || initSet.serverName || realSet.serverNames?.[0] || 'gateway.icloud.com')
    setRealityDest(realSet.dest || initStream.dest || initSet.dest || 'gateway.icloud.com:443')
    setRealityPublicKey(initStream.publicKey || initSet.publicKey || realSet.publicKey || '')
    setRealityPrivateKey(initStream.privateKey || initSet.privateKey || realSet.privateKey || '')
    setRealityShortId(initStream.shortId || initSet.shortId || realSet.shortIds?.[0] || '')
    setRealityFlow(initSet.flow || realSet.flow || 'xtls-rprx-vision')

    setTlsSni(initStream.tlsSettings?.serverName || initStream.serverName || initSet.serverName || '')
    const alpnSource = initStream.tlsSettings?.alpn || initStream.alpn
    setTlsAlpn(Array.isArray(alpnSource) ? alpnSource.join(',') : (alpnSource || 'h2,http/1.1'))
    const initInsecure = initStream.insecure !== undefined
      ? Boolean(initStream.insecure)
      : (initSet.insecure !== undefined ? Boolean(initSet.insecure) : Boolean(initStream.tlsSettings?.allowInsecure))
    setTlsInsecure(initInsecure)

    const initCertFile = initStream.certificateFile || initStream.tlsSettings?.certificates?.[0]?.certificateFile || ''
    const initKeyFile = initStream.keyFile || initStream.tlsSettings?.certificates?.[0]?.keyFile || ''
    setCertificateFile(initCertFile)
    setKeyFile(initKeyFile)
    setCertMode(initStream.certMode || initSet.certMode || (initCertFile ? 'custom' : 'selfsigned'))

    setShadowtlsSni(initSet.serverName || initSet.sni || 'gateway.icloud.com')
    setShadowtlsPassword(initSet.shadowtlsPassword || initSet.password || '')
    setShadowtlsVersion(initSet.shadowtlsVersion || initSet.version || 3)
    setSsMethod(initSet.ssMethod || initSet.method || '2022-blake3-aes-128-gcm')
    setSsPassword(initSet.ssPassword || initSet.password || '')

    setHy2Auth(initSet.auth || initSet.password || '')
    setHy2ObfsPassword(
      initSet.obfsPassword || initStream.obfsPassword || initStream.finalmask?.udp?.[0]?.settings?.password || ''
    )
    setHy2Ports(initSet.ports || initStream.ports || '')
    setHy2HopInterval(initSet.hopInterval || initStream.hopInterval || '5-10')
    setHy2Sni(initStream.tlsSettings?.serverName || initStream.serverName || initSet.serverName || 'gateway.icloud.com')
    setHy2Insecure(initInsecure)
    setHy2UpMbps(initSet.up_mbps || initStream.up_mbps || 100)
    setHy2DownMbps(initSet.down_mbps || initStream.down_mbps || 100)

    setGeneralPassword(initSet.password || '')
    setTuicCongestion(initSet.congestion_control || 'bbr')
  }, [isOpen, inbound])

  if (!isOpen || !inbound) return null

  const { settings: initialSettings, streamSettings: initialStream } = extractSettings(inbound)
  const protocol = (inbound.protocol || inbound.type || '').toLowerCase()
  const engine = inbound.engine || 'singbox'

  const handleGenerateKeypair = async () => {
    try {
      setGenKeyLoading(true)
      const res = await api.get('/inbounds/gen-keypair')
      if (res.data.success) {
        setRealityPrivateKey(res.data.data.privateKey || '')
        setRealityPublicKey(res.data.data.publicKey || '')
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

      // 2. VLESS / VMess / Trojan
      if (protocol === 'vless' || protocol === 'vmess' || protocol === 'trojan') {
        payload.stream_settings.network = transport
        payload.stream_settings.wsPath = wsPath
        payload.stream_settings.wsHost = wsHost
        payload.stream_settings.grpcServiceName = grpcServiceName
        payload.stream_settings.security = protocol === 'trojan' && security === 'none' ? 'tls' : security

        if (payload.stream_settings.security === 'reality') {
          payload.stream_settings.serverName = realitySni
          payload.stream_settings.dest = realityDest
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
          if (protocol === 'vless') {
            payload.settings.flow = realityFlow
          }
        } else if (payload.stream_settings.security === 'tls') {
          const certVals = certMode === 'selfsigned'
            ? { certificateFile: '', keyFile: '' }
            : { certificateFile: certificateFile.trim(), keyFile: keyFile.trim() }

          payload.settings.serverName = tlsSni
          payload.settings.insecure = Boolean(tlsInsecure)
          payload.settings.certMode = certMode
          payload.stream_settings.serverName = tlsSni
          payload.stream_settings.insecure = Boolean(tlsInsecure)
          payload.stream_settings.certMode = certMode
          payload.stream_settings.certificateFile = certVals.certificateFile
          payload.stream_settings.keyFile = certVals.keyFile
          payload.stream_settings.tlsSettings = {
            serverName: tlsSni,
            alpn: tlsAlpn ? tlsAlpn.split(',').map((s) => s.trim()).filter(Boolean) : ['h2', 'http/1.1'],
            allowInsecure: Boolean(tlsInsecure),
            certificates: [certVals],
          }
        }
      }

      // 3. Hysteria 2
      if (protocol === 'hysteria2' || protocol === 'hysteria') {
        const trimmedObfs = hy2ObfsPassword.trim()
        const trimmedPorts = hy2Ports.trim()
        const certVals = certMode === 'selfsigned'
          ? { certificateFile: '', keyFile: '' }
          : { certificateFile: certificateFile.trim(), keyFile: keyFile.trim() }

        payload.settings.auth = hy2Auth
        payload.settings.password = hy2Auth
        payload.settings.obfsPassword = trimmedObfs
        payload.settings.ports = trimmedPorts
        payload.settings.udpHopPorts = trimmedPorts
        payload.settings.hopInterval = hy2HopInterval || '5-10'
        payload.settings.up_mbps = parseInt(hy2UpMbps || 100, 10)
        payload.settings.down_mbps = parseInt(hy2DownMbps || 100, 10)
        payload.settings.serverName = hy2Sni.trim()
        payload.settings.insecure = Boolean(hy2Insecure)
        payload.settings.certMode = certMode

        payload.stream_settings.network = 'hysteria'
        payload.stream_settings.security = 'tls'
        payload.stream_settings.serverName = hy2Sni.trim()
        payload.stream_settings.insecure = Boolean(hy2Insecure)
        payload.stream_settings.certMode = certMode
        payload.stream_settings.certificateFile = certVals.certificateFile
        payload.stream_settings.keyFile = certVals.keyFile
        payload.stream_settings.ports = trimmedPorts
        payload.stream_settings.udpHopPorts = trimmedPorts
        payload.stream_settings.hopInterval = hy2HopInterval || '5-10'
        payload.stream_settings.obfsPassword = trimmedObfs
        payload.stream_settings.tlsSettings = {
          ...(initialStream.tlsSettings || {}),
          alpn: ['h3'],
          serverName: hy2Sni.trim(),
          allowInsecure: Boolean(hy2Insecure),
          certificates: [certVals],
        }
        if (trimmedObfs) {
          payload.stream_settings.finalmask = {
            udp: [{ type: 'salamander', settings: { password: trimmedObfs } }],
          }
        } else {
          delete payload.stream_settings.finalmask
        }
      }

      // 4. Trojan / Shadowsocks
      if (protocol === 'trojan' || protocol === 'shadowsocks') {
        payload.settings.password = generalPassword
        if (protocol === 'shadowsocks') {
          payload.settings.method = ssMethod
        }
      }

      // 5. TUIC
      if (protocol === 'tuic') {
        const certVals = certMode === 'selfsigned'
          ? { certificateFile: '', keyFile: '' }
          : { certificateFile: certificateFile.trim(), keyFile: keyFile.trim() }

        payload.settings.congestion_control = tuicCongestion
        payload.settings.serverName = tlsSni.trim()
        payload.settings.insecure = Boolean(tlsInsecure)
        payload.settings.certMode = certMode
        payload.stream_settings.security = 'tls'
        payload.stream_settings.serverName = tlsSni.trim()
        payload.stream_settings.insecure = Boolean(tlsInsecure)
        payload.stream_settings.certMode = certMode
        payload.stream_settings.certificateFile = certVals.certificateFile
        payload.stream_settings.keyFile = certVals.keyFile
        payload.stream_settings.tlsSettings = {
          ...(initialStream.tlsSettings || {}),
          alpn: ['h3'],
          serverName: tlsSni.trim(),
          allowInsecure: Boolean(tlsInsecure),
          certificates: [certVals],
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
                      onClick={() => setSsPassword(generateBase64Key(ssMethod.includes('256') ? 32 : 16))}
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

          {/* 2. VLESS / VMess / Trojan */}
          {(protocol === 'vless' || protocol === 'vmess' || protocol === 'trojan') && (
            <div className="bg-[#14161f] border border-indigo-500/30 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center space-x-1.5">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                <span className="uppercase">{protocol} Security & Transport Settings</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Security Type</label>
                  <select
                    value={security}
                    onChange={(e) => setSecurity(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {protocol !== 'vmess' && protocol !== 'trojan' && (
                      <option value="reality">Reality (Zero-Cert Camouflage)</option>
                    )}
                    <option value="tls">TLS (Self-Signed / Domain Cert)</option>
                    {protocol !== 'trojan' && <option value="none">None (Plaintext)</option>}
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
                    <option value="httpupgrade">HTTPUpgrade</option>
                  </select>
                </div>
              </div>

              {(transport === 'ws' || transport === 'httpupgrade') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Path</label>
                    <input
                      type="text"
                      value={wsPath}
                      onChange={(e) => setWsPath(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Host Header</label>
                    <input
                      type="text"
                      value={wsHost}
                      onChange={(e) => setWsHost(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}

              {transport === 'grpc' && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">gRPC Service Name</label>
                  <input
                    type="text"
                    value={grpcServiceName}
                    onChange={(e) => setGrpcServiceName(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

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
                          <span>Ideal SNI Finder</span>
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

                    {protocol === 'vless' && (
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
                    )}
                  </div>
                </div>
              )}

              {security === 'tls' && (
                <div className="space-y-3 pt-2 border-t border-[#2d3148]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">TLS SNI Domain</label>
                      <input
                        type="text"
                        value={tlsSni}
                        onChange={(e) => setTlsSni(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Certificate Mode</label>
                      <select
                        value={certMode}
                        onChange={(e) => {
                          const mode = e.target.value
                          setCertMode(mode)
                          if (mode === 'selfsigned') setTlsInsecure(true)
                        }}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="selfsigned">Self-Signed (Auto-Generate)</option>
                        <option value="settings">Panel Settings Cert</option>
                        <option value="custom">Custom Paths</option>
                      </select>
                    </div>
                  </div>
                  {certMode !== 'selfsigned' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Fullchain Cert Path</label>
                        <input
                          type="text"
                          value={certificateFile}
                          onChange={(e) => setCertificateFile(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Private Key Path</label>
                        <input
                          type="text"
                          value={keyFile}
                          onChange={(e) => setKeyFile(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="editTlsInsecure"
                      checked={tlsInsecure}
                      onChange={(e) => setTlsInsecure(e.target.checked)}
                      className="rounded bg-[#1a1d27] border-[#2d3148] text-indigo-600 focus:ring-0"
                    />
                    <label htmlFor="editTlsInsecure" className="text-xs text-slate-300">
                      Skip TLS Certificate Verification on clients (insecure)
                    </label>
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
                      onClick={() => setHy2ObfsPassword(generatePassword(8))}
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
                  <label className="text-xs text-slate-400 block mb-1">Port Hopping Range (e.g. 20000-50000)</label>
                  <input
                    type="text"
                    value={hy2Ports}
                    onChange={(e) => setHy2Ports(e.target.value)}
                    placeholder="20000-50000"
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Hop Interval (Sec)</label>
                  <input
                    type="text"
                    value={hy2HopInterval}
                    onChange={(e) => setHy2HopInterval(e.target.value)}
                    placeholder="5-10"
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
                    placeholder="gateway.icloud.com"
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Certificate Mode</label>
                  <select
                    value={certMode}
                    onChange={(e) => {
                      const mode = e.target.value
                      setCertMode(mode)
                      if (mode === 'selfsigned') setHy2Insecure(true)
                    }}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="selfsigned">Self-Signed (Auto for SNI)</option>
                    <option value="settings">Panel Settings Cert</option>
                    <option value="custom">Custom Paths</option>
                  </select>
                </div>
              </div>

              {certMode !== 'selfsigned' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Fullchain Certificate Path</label>
                    <input
                      type="text"
                      value={certificateFile}
                      onChange={(e) => setCertificateFile(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Private Key Path</label>
                    <input
                      type="text"
                      value={keyFile}
                      onChange={(e) => setKeyFile(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2 pt-1">
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
          )}

          {/* 4. SHADOWSOCKS */}
          {protocol === 'shadowsocks' && (
            <div className="bg-[#14161f] border border-emerald-500/30 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Shadowsocks Settings</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Method</label>
                  <select
                    value={ssMethod}
                    onChange={(e) => setSsMethod(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  >
                    {ssMethods.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Server Key / Password</label>
                  <input
                    type="text"
                    value={generalPassword}
                    onChange={(e) => setGeneralPassword(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 5. TUIC */}
          {protocol === 'tuic' && (
            <div className="bg-[#14161f] border border-indigo-500/30 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">TUIC v5 Settings</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Congestion Control</label>
                  <select
                    value={tuicCongestion}
                    onChange={(e) => setTuicCongestion(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="bbr">BBR</option>
                    <option value="cubic">CUBIC</option>
                    <option value="new_reno">New Reno</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">TLS SNI Domain</label>
                  <input
                    type="text"
                    value={tlsSni}
                    onChange={(e) => setTlsSni(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Certificate Mode</label>
                  <select
                    value={certMode}
                    onChange={(e) => {
                      const mode = e.target.value
                      setCertMode(mode)
                      if (mode === 'selfsigned') setTlsInsecure(true)
                    }}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="selfsigned">Self-Signed (Auto)</option>
                    <option value="settings">Panel Settings Cert</option>
                    <option value="custom">Custom Paths</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2 pt-5">
                  <input
                    type="checkbox"
                    id="editTuicInsecure"
                    checked={tlsInsecure}
                    onChange={(e) => setTlsInsecure(e.target.checked)}
                    className="rounded bg-[#1a1d27] border-[#2d3148] text-indigo-600 focus:ring-0"
                  />
                  <label htmlFor="editTuicInsecure" className="text-xs text-slate-300">
                    Skip TLS Verification (insecure)
                  </label>
                </div>
              </div>
              {certMode !== 'selfsigned' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Fullchain Cert Path</label>
                    <input
                      type="text"
                      value={certificateFile}
                      onChange={(e) => setCertificateFile(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Private Key Path</label>
                    <input
                      type="text"
                      value={keyFile}
                      onChange={(e) => setKeyFile(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}
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
