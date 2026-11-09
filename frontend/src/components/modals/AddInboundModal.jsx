import React, { useState, useEffect } from 'react'
import {
  X,
  Check,
  Shield,
  Zap,
  Radio,
  ChevronRight,
  ChevronLeft,
  Key,
  RefreshCw,
  Sliders,
  Network,
  Lock,
  User,
  Hash,
  Globe,
} from 'lucide-react'
import { generateUUID, generatePassword, generateHexPassword, generateBase64Key } from '../../utils/links'
import api from '../../utils/api'
import toast from 'react-hot-toast'
import Spinner from '../ui/Spinner'

const protocolsByEngine = {
  singbox: [
    { type: 'shadowtls', name: 'ShadowTLS v3 + SS', desc: 'Camouflage TLS handshake + SS 2022 detour' },
    { type: 'shadowsocks', name: 'Shadowsocks 2022', desc: 'Fast modern AEAD Blake3 cipher' },
    { type: 'vless', name: 'VLESS Reality / TLS', desc: 'No-cert Reality camouflage or standard TLS' },
    { type: 'hysteria2', name: 'Hysteria 2', desc: 'Ultra-fast UDP QUIC protocol with Salamander obfs' },
    { type: 'tuic', name: 'TUIC v5', desc: 'QUIC with BBR congestion control and 0-RTT' },
    { type: 'trojan', name: 'Trojan + TLS', desc: 'HTTPS mimicking TLS proxy' },
    { type: 'vmess', name: 'VMess + WebSocket', desc: 'CDN-compatible reverse proxy' },
    { type: 'mixed', name: 'Mixed (SOCKS5/HTTP)', desc: 'Unified local/public SOCKS5 & HTTP listener' },
    { type: 'wireguard', name: 'WireGuard', desc: 'Native kernel-level UDP VPN' },
  ],
  xray: [
    { type: 'vless', name: 'VLESS Reality / TLS', desc: 'XTLS Vision + Reality zero-certificate anti-censorship' },
    { type: 'vmess', name: 'VMess (WS / gRPC / TCP)', desc: 'Classic V2Ray protocol with rich transports' },
    { type: 'trojan', name: 'Trojan + TLS / Reality', desc: 'Mimics real HTTPS web traffic' },
    { type: 'shadowsocks', name: 'Shadowsocks (2022/AEAD)', desc: 'Full cipher support with UDP Relay' },
    { type: 'hysteria2', name: 'Hysteria 2 (Xray)', desc: 'Native Xray Hysteria v2 with Finalmask' },
    { type: 'socks', name: 'SOCKS5 Proxy', desc: 'Standard SOCKS5 with authentication' },
    { type: 'http', name: 'HTTP Proxy', desc: 'Plain or authenticated HTTP proxy' },
  ],
}

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

export default function AddInboundModal({ isOpen, onClose, onSuccess }) {
  const [step, setStep] = useState(1)
  const [engine, setEngine] = useState('singbox')
  const [selectedProtocol, setSelectedProtocol] = useState('shadowtls')
  const [loading, setLoading] = useState(false)
  const [genKeyLoading, setGenKeyLoading] = useState(false)

  // 1. General Settings
  const [remark, setRemark] = useState('')
  const [port, setPort] = useState(Math.floor(10000 + Math.random() * 50000))
  const [listen, setListen] = useState('0.0.0.0')
  const [totalTrafficLimitGb, setTotalTrafficLimitGb] = useState(0)
  const [expiryDays, setExpiryDays] = useState(0)

  // 2. Transport (Network)
  const [transport, setTransport] = useState('tcp') // tcp, ws, grpc, httpupgrade
  const [wsPath, setWsPath] = useState('/')
  const [wsHost, setWsHost] = useState('')
  const [grpcServiceName, setGrpcServiceName] = useState('')

  // 3. Security (none, tls, reality)
  const [security, setSecurity] = useState('none')
  const [serverName, setServerName] = useState('gateway.icloud.com')
  const [dest, setDest] = useState('gateway.icloud.com:443')
  const [privateKey, setPrivateKey] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [shortId, setShortId] = useState(generatePassword(4))
  const [fingerprint, setFingerprint] = useState('chrome')
  const [alpn, setAlpn] = useState('h2,http/1.1')

  // 4. Protocol Specifics
  const [ssMethod, setSsMethod] = useState('2022-blake3-aes-128-gcm')
  const [ssPassword, setSsPassword] = useState(() => generateBase64Key(16))
  const [shadowtlsPassword, setShadowtlsPassword] = useState(() => generateHexPassword(16))
  const [password, setPassword] = useState(() => generatePassword(16))
  const [shadowtlsVersion, setShadowtlsVersion] = useState(3)
  const [upMbps, setUpMbps] = useState(100)
  const [downMbps, setDownMbps] = useState(100)
  const [obfsEnabled, setObfsEnabled] = useState(true)
  const [obfsPassword, setObfsPassword] = useState(() => generatePassword(8))
  const [udpHopEnabled, setUdpHopEnabled] = useState(true)
  const [udpHopPorts, setUdpHopPorts] = useState('20000-50000')
  const [hopInterval, setHopInterval] = useState('5-10')
  const [certPreset, setCertPreset] = useState('settings')
  const [certificateFile, setCertificateFile] = useState('')
  const [keyFile, setKeyFile] = useState('')
  const [clientAuth, setClientAuth] = useState(() => generatePassword(16))
  const [tuicCongestion, setTuicCongestion] = useState('bbr')

  // 5. Client & Flow
  const [clientEmail, setClientEmail] = useState(`user_${Date.now().toString(36)}`)
  const [clientUuid, setClientUuid] = useState(generateUUID())
  const [clientFlow, setClientFlow] = useState('xtls-rprx-vision')

  // 6. Sniffing
  const [sniffing, setSniffing] = useState(true)

  useEffect(() => {
    if (isOpen) {
      // Load configured certificates dynamically from settings API
      api.get('/settings').then((res) => {
        if (res.data?.data) {
          if (res.data.data.cert_fullchain) setCertificateFile(res.data.data.cert_fullchain)
          if (res.data.data.cert_privkey) setKeyFile(res.data.data.cert_privkey)
        }
      }).catch(() => {})
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleCertPresetChange = (preset) => {
    setCertPreset(preset)
    const currentHost = window.location.hostname || ''
    if (preset === 'settings') {
      api.get('/settings').then((res) => {
        if (res.data?.data) {
          if (res.data.data.cert_fullchain) setCertificateFile(res.data.data.cert_fullchain)
          if (res.data.data.cert_privkey) setKeyFile(res.data.data.cert_privkey)
        }
      }).catch(() => {})
      setServerName(currentHost)
    } else if (preset === 'letsencrypt') {
      setServerName(currentHost)
      setCertificateFile(`/etc/letsencrypt/live/${currentHost}/fullchain.pem`)
      setKeyFile(`/etc/letsencrypt/live/${currentHost}/privkey.pem`)
    } else if (preset === 'custom') {
      // Keep existing or clear
    }
  }

  const handleProtocolSelect = (protoType) => {
    setSelectedProtocol(protoType)
    setRemark(`${engine}-${protoType}-${port}`)
    const currentHost = window.location.hostname || ''

    if (protoType === 'shadowtls') {
      setSecurity('none')
      setServerName('gateway.icloud.com')
      setDest('gateway.icloud.com:443')
      setSsMethod('2022-blake3-aes-128-gcm')
      setShadowtlsPassword(generateHexPassword(16))
      setSsPassword(generateBase64Key(16))
    } else if (protoType === 'vless') {
      setSecurity('reality')
      setServerName('www.microsoft.com')
      setDest('www.microsoft.com:443')
      setClientFlow('xtls-rprx-vision')
      generateRealityKeys()
    } else if (protoType === 'hysteria2') {
      setSecurity('tls')
      setServerName(currentHost)
      setAlpn('h3,h2,http/1.1')
      setCertPreset('settings')
      setUdpHopEnabled(true)
      setUdpHopPorts('20000-50000')
      setHopInterval('5-10')
      setObfsEnabled(true)
      setObfsPassword(generatePassword(8))
      setClientAuth(generatePassword(16))
    } else if (protoType === 'tuic') {
      setSecurity('tls')
      setServerName(currentHost)
    } else if (protoType === 'trojan') {
      setSecurity('tls')
      setServerName(currentHost)
    } else if (protoType === 'vmess') {
      setTransport('ws')
      setWsPath('/vmess-ws')
    }
  }

  const generateRealityKeys = async () => {
    try {
      setGenKeyLoading(true)
      const res = await api.get('/inbounds/gen-keypair')
      if (res.data?.data) {
        setPrivateKey(res.data.data.privateKey || '')
        setPublicKey(res.data.data.publicKey || '')
        if (res.data.data.shortId) setShortId(res.data.data.shortId)
        toast.success('Generated fresh X25519 reality keypair!')
      }
    } catch {
      setPrivateKey(generatePassword(32))
      setPublicKey(generatePassword(32))
      setShortId(generatePassword(4))
    } finally {
      setGenKeyLoading(false)
    }
  }

  const handlePresetSelect = (preset) => {
    setServerName(preset.sni)
    setDest(preset.dest)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)

      const expiryEpoch = expiryDays > 0 ? Math.floor(Date.now() / 1000) + expiryDays * 86400 : 0
      const bytesLimit = totalTrafficLimitGb > 0 ? totalTrafficLimitGb * 1024 * 1024 * 1024 : 0

      const finalObfs = (selectedProtocol === 'hysteria2' && obfsEnabled) ? obfsPassword.trim() : ''
      const finalHopPorts = (selectedProtocol === 'hysteria2' && udpHopEnabled) ? udpHopPorts.trim() : ''
      const finalClientPass = selectedProtocol === 'shadowtls'
        ? shadowtlsPassword
        : (selectedProtocol === 'hysteria2' ? clientAuth : password)

      const payload = {
        engine,
        type: selectedProtocol,
        listen,
        port: parseInt(port, 10),
        remark: remark || `${selectedProtocol}-${port}`,
        total_bytes_limit: bytesLimit,
        expiry_time: expiryEpoch,
        settings: {
          method: ssMethod,
          ssMethod,
          ssPassword,
          shadowtlsPassword,
          password: finalClientPass,
          serverName,
          shadowtlsVersion,
          up_mbps: upMbps,
          down_mbps: downMbps,
          obfsPassword: finalObfs,
          ports: finalHopPorts,
          udpHopPorts: finalHopPorts,
          hopInterval,
          congestion_control: tuicCongestion,
          dest,
          privateKey,
          publicKey,
          shortId,
          fingerprint,
        },
        stream_settings: {
          network: selectedProtocol === 'hysteria2' ? 'hysteria' : transport,
          security,
          serverName,
          dest,
          privateKey,
          publicKey,
          shortId,
          fingerprint,
          alpn: alpn.split(',').map((s) => s.trim()),
          wsPath,
          wsHost,
          grpcServiceName,
          obfsPassword: finalObfs,
          ports: finalHopPorts,
          udpHopPorts: finalHopPorts,
          hopInterval,
          certificateFile,
          keyFile,
          sniffing,
          ...(selectedProtocol === 'hysteria2' && (finalHopPorts || finalObfs) ? {
            finalmask: {
              ...(finalHopPorts ? {
                quicParams: {
                  congestion: 'bbr',
                  udpHop: {
                    ports: finalHopPorts,
                    interval: hopInterval || '5-10',
                  },
                },
              } : {}),
              ...(finalObfs ? {
                udp: [
                  {
                    type: 'salamander',
                    settings: { password: finalObfs },
                  },
                ],
              } : {}),
            },
          } : {}),
          ...(selectedProtocol === 'hysteria2' ? {
            hysteriaSettings: {
              auth: '',
              udpIdleTimeout: 60,
              version: 2,
            },
            tlsSettings: {
              alpn: ['h3', 'h2', 'http/1.1'],
              serverName,
              certificates: [
                {
                  certificateFile,
                  keyFile,
                },
              ],
            },
          } : {}),
        },
        clients: [
          {
            email: clientEmail,
            uuid: clientUuid,
            password: finalClientPass,
            flow: selectedProtocol === 'vless' && security === 'reality' ? clientFlow : '',
            total_bytes_limit: bytesLimit,
            expiry_time: expiryEpoch,
            remark: 'Primary User',
          },
        ],
      }

      const res = await api.post('/inbounds', payload)
      if (res.data.success) {
        toast.success(`Inbound ${remark} created and deployed!`)
        onSuccess(res.data.data)
        onClose()
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2d3148]">
          <div className="flex items-center space-x-2.5">
            <Radio className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-semibold text-white">Add Inbound Configuration</h3>
              <p className="text-xs text-slate-400">Step {step} of 2 — {step === 1 ? 'Select Engine & Protocol' : 'Fine-tune Configuration'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto py-4 pr-1">
          {step === 1 ? (
            <div className="space-y-5">
              {/* Core Engine Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">Core Engine</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEngine('singbox')
                      handleProtocolSelect('shadowtls')
                    }}
                    className={`p-4 rounded-xl border text-left transition flex items-center space-x-3.5 ${
                      engine === 'singbox'
                        ? 'bg-purple-950/40 border-purple-500/80 text-purple-300 shadow-lg shadow-purple-950/30'
                        : 'bg-[#14161f] border-[#2d3148] text-slate-400 hover:bg-slate-800/40'
                    }`}
                  >
                    <Shield className="w-6 h-6 text-purple-400 flex-shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm text-white">sing-box</h4>
                      <p className="text-xs text-slate-400">Next-gen core, ShadowTLS, TUIC, SS 2022</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEngine('xray')
                      handleProtocolSelect('vless')
                    }}
                    className={`p-4 rounded-xl border text-left transition flex items-center space-x-3.5 ${
                      engine === 'xray'
                        ? 'bg-blue-950/40 border-blue-500/80 text-blue-300 shadow-lg shadow-blue-950/30'
                        : 'bg-[#14161f] border-[#2d3148] text-slate-400 hover:bg-slate-800/40'
                    }`}
                  >
                    <Zap className="w-6 h-6 text-blue-400 flex-shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm text-white">Xray-core</h4>
                      <p className="text-xs text-slate-400">Battle-tested VLESS Reality, VMess, XTLS</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Protocol Grid */}
              <div>
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">Protocol Selection</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {protocolsByEngine[engine].map((proto) => (
                    <button
                      key={proto.type}
                      type="button"
                      onClick={() => handleProtocolSelect(proto.type)}
                      className={`p-3.5 rounded-xl border text-left transition ${
                        selectedProtocol === proto.type
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md'
                          : 'bg-[#14161f] border-[#2d3148] text-slate-400 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-xs text-white">{proto.name}</p>
                        {selectedProtocol === proto.type && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{proto.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <form id="inbound-form" onSubmit={handleSubmit} className="space-y-5">
              {/* 1. General Info */}
              <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span>General Parameters</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Remark / Tag</label>
                    <input
                      type="text"
                      required
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-slate-400">Listen Port</label>
                      <button
                        type="button"
                        onClick={() => setPort(Math.floor(10000 + Math.random() * 50000))}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300"
                      >
                        Randomize
                      </button>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      required
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Listen IP</label>
                    <select
                      value={listen}
                      onChange={(e) => setListen(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="0.0.0.0">0.0.0.0 (IPv4)</option>
                      <option value="::">:: (IPv4 + IPv6)</option>
                      <option value="127.0.0.1">127.0.0.1 (Localhost)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Traffic Quota (GB, 0 = Unlimited)</label>
                    <input
                      type="number"
                      min="0"
                      value={totalTrafficLimitGb}
                      onChange={(e) => setTotalTrafficLimitGb(parseInt(e.target.value || 0, 10))}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Validity (Days, 0 = Never)</label>
                    <input
                      type="number"
                      min="0"
                      value={expiryDays}
                      onChange={(e) => setExpiryDays(parseInt(e.target.value || 0, 10))}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Security & Camouflage */}
              <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    <Lock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Security & Camouflage</span>
                  </div>

                  {/* Security switcher */}
                  <div className="flex items-center space-x-1 bg-[#1a1d27] p-1 rounded-lg border border-[#2d3148] text-xs">
                    {['none', 'tls', 'reality'].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => {
                          setSecurity(sec)
                          if (sec === 'reality' && !privateKey) generateRealityKeys()
                        }}
                        className={`px-2.5 py-0.5 rounded-md capitalize font-medium transition ${
                          security === sec ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {sec}
                      </button>
                    ))}
                  </div>
                </div>

                {security === 'reality' && (
                  <div className="space-y-3 pt-2">
                    {/* SNI Presets */}
                    <div>
                      <span className="text-[11px] text-slate-400 block mb-1">Reality Target Presets:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {realityTargetSniPresets.map((p) => (
                          <button
                            key={p.sni}
                            type="button"
                            onClick={() => handlePresetSelect(p)}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Target Server (dest)</label>
                        <input
                          type="text"
                          required
                          value={dest}
                          onChange={(e) => setDest(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-slate-400 block mb-1">SNI (Server Name)</label>
                        <input
                          type="text"
                          required
                          value={serverName}
                          onChange={(e) => setServerName(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-slate-400">Private Key</label>
                          <button
                            type="button"
                            onClick={generateRealityKeys}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                          >
                            <RefreshCw className={`w-3 h-3 ${genKeyLoading ? 'animate-spin' : ''}`} />
                            <span>Gen Keys</span>
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          value={privateKey}
                          onChange={(e) => setPrivateKey(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Public Key (Client Share)</label>
                        <input
                          type="text"
                          value={publicKey}
                          onChange={(e) => setPublicKey(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-slate-400">Short ID</label>
                          <button
                            type="button"
                            onClick={() => setShortId(generatePassword(4))}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300"
                          >
                            New ShortID
                          </button>
                        </div>
                        <input
                          type="text"
                          value={shortId}
                          onChange={(e) => setShortId(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-slate-400 block mb-1">uTLS Fingerprint</label>
                        <select
                          value={fingerprint}
                          onChange={(e) => setFingerprint(e.target.value)}
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="chrome">Chrome (Recommended)</option>
                          <option value="firefox">Firefox</option>
                          <option value="safari">Safari</option>
                          <option value="ios">iOS</option>
                          <option value="random">Randomized</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {security === 'tls' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">SNI / Domain</label>
                      <input
                        type="text"
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        placeholder="example.com or server IP"
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">ALPN</label>
                      <input
                        type="text"
                        value={alpn}
                        onChange={(e) => setAlpn(e.target.value)}
                        placeholder="h2,http/1.1"
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Transport Network */}
              {['vless', 'vmess', 'trojan'].includes(selectedProtocol) && (
                <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    <Network className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Transport Protocol</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Network Stream</label>
                      <select
                        value={transport}
                        onChange={(e) => setTransport(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="tcp">TCP (Default)</option>
                        <option value="ws">WebSocket (CDN)</option>
                        <option value="grpc">gRPC</option>
                        <option value="httpupgrade">HTTPUpgrade</option>
                      </select>
                    </div>

                    {transport === 'ws' && (
                      <>
                        <div>
                          <label className="text-xs text-slate-400 block mb-1">WS Path</label>
                          <input
                            type="text"
                            value={wsPath}
                            onChange={(e) => setWsPath(e.target.value)}
                            className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 block mb-1">WS Host Header</label>
                          <input
                            type="text"
                            value={wsHost}
                            onChange={(e) => setWsHost(e.target.value)}
                            placeholder="Optional host"
                            className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </>
                    )}

                    {transport === 'grpc' && (
                      <div className="sm:col-span-2">
                        <label className="text-xs text-slate-400 block mb-1">gRPC Service Name</label>
                        <input
                          type="text"
                          value={grpcServiceName}
                          onChange={(e) => setGrpcServiceName(e.target.value)}
                          placeholder="grpc-service"
                          className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 4. Protocol Specifics */}
              {selectedProtocol === 'shadowtls' && (
                <div className="bg-[#14161f] border border-purple-500/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-purple-300 uppercase tracking-wider">
                    <Shield className="w-3.5 h-3.5 text-purple-400" />
                    <span>ShadowTLS v3 + Shadowsocks 2022 Configuration</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Handshake SNI / Server</label>
                      <input
                        type="text"
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        placeholder="gateway.icloud.com"
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-purple-300 font-medium">Initial Client ShadowTLS Password</label>
                        <button
                          type="button"
                          onClick={() => setShadowtlsPassword(generateHexPassword(16))}
                          className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center space-x-1"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          <span>Gen</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={shadowtlsPassword}
                        onChange={(e) => setShadowtlsPassword(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Detoured Shadowsocks Cipher</label>
                      <select
                        value={ssMethod}
                        onChange={(e) => setSsMethod(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                      >
                        {ssMethods.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-slate-400">Detoured Shadowsocks Key (Base64)</label>
                        <button
                          type="button"
                          onClick={() => setSsPassword(generateBase64Key(16))}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          <span>Gen</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={ssPassword}
                        onChange={(e) => setSsPassword(e.target.value)}
                        placeholder="Base64 16-byte key"
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedProtocol === 'shadowsocks' && (
                <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    <Key className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Shadowsocks Cipher</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Method / Cipher</label>
                      <select
                        value={ssMethod}
                        onChange={(e) => setSsMethod(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      >
                        {ssMethods.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-slate-400">Password / Key</label>
                        <button
                          type="button"
                          onClick={() => setPassword(generatePassword(16))}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300"
                        >
                          Gen
                        </button>
                      </div>
                      <input
                        type="text"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedProtocol === 'hysteria2' && (
                <div className="bg-[#14161f] border border-amber-500/30 rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-amber-300 uppercase tracking-wider">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Hysteria 2 Anti-Censorship Configuration</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Russia & China Bypass Ready
                    </span>
                  </div>

                  <div className="p-2.5 bg-amber-950/20 border border-amber-500/20 rounded-lg text-[11px] text-amber-200/90 leading-relaxed">
                    Combines <strong>Salamander obfuscation</strong> (scrambling QUIC headers against TSPU/GFW protocol matching) and <strong>UDP port hopping</strong> (cycling through 30,000 ports to defeat port throttling and firewall session drops).
                  </div>

                  {/* 1. Salamander Obfs */}
                  <div className="p-3 bg-[#1a1d27] border border-[#2d3148] rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs font-medium text-slate-200">Salamander Obfuscation</label>
                        <p className="text-[10px] text-slate-400">Scrambles QUIC packets so DPI cannot identify Hysteria 2 protocol</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setObfsEnabled(!obfsEnabled)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                          obfsEnabled ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {obfsEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>

                    {obfsEnabled && (
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-amber-300">Salamander Password</label>
                          <button
                            type="button"
                            onClick={() => setObfsPassword(generatePassword(8))}
                            className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center space-x-1"
                          >
                            <RefreshCw className="w-2.5 h-2.5" />
                            <span>Gen New</span>
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          value={obfsPassword}
                          onChange={(e) => setObfsPassword(e.target.value)}
                          className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    )}
                  </div>

                  {/* 2. UDP Port Hopping */}
                  <div className="p-3 bg-[#1a1d27] border border-[#2d3148] rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs font-medium text-slate-200">UDP Port Hopping</label>
                        <p className="text-[10px] text-slate-400">Randomizes destination UDP ports dynamically to bypass throttling</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUdpHopEnabled(!udpHopEnabled)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                          udpHopEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {udpHopEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>

                    {udpHopEnabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                        <div>
                          <label className="text-xs text-slate-400 block mb-1">Port Range</label>
                          <input
                            type="text"
                            required
                            value={udpHopPorts}
                            onChange={(e) => setUdpHopPorts(e.target.value)}
                            placeholder="20000-50000"
                            className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                          />
                          <span className="text-[10px] text-slate-500">Redirected via Linux kernel iptables</span>
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 block mb-1">Hop Interval (sec)</label>
                          <input
                            type="text"
                            value={hopInterval}
                            onChange={(e) => setHopInterval(e.target.value)}
                            placeholder="5-10 or 30"
                            className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                          />
                          <span className="text-[10px] text-slate-500">e.g. 5-10 or 30</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. TLS Certificates & SNI */}
                  <div className="p-3 bg-[#1a1d27] border border-[#2d3148] rounded-xl space-y-2">
                    <label className="text-xs font-medium text-slate-200 block">TLS Certificate & Server Domain</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleCertPresetChange('settings')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                          certPreset === 'settings'
                            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        Panel Settings Cert
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCertPresetChange('letsencrypt')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                          certPreset === 'letsencrypt'
                            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        Let's Encrypt Default
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCertPresetChange('custom')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                          certPreset === 'custom'
                            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        Custom Paths
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">SNI (Server Name)</label>
                        <input
                          type="text"
                          required
                          value={serverName}
                          onChange={(e) => setServerName(e.target.value)}
                          className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">ALPN Protocol</label>
                        <input
                          type="text"
                          value={alpn}
                          onChange={(e) => setAlpn(e.target.value)}
                          className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4. Bandwidth limits */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Up Bandwidth (Mbps)</label>
                      <input
                        type="number"
                        value={upMbps}
                        onChange={(e) => setUpMbps(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Down Bandwidth (Mbps)</label>
                      <input
                        type="number"
                        value={downMbps}
                        onChange={(e) => setDownMbps(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 5. Client Information */}
              <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  <User className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Initial Client User</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Email / Label</label>
                    <input
                      type="text"
                      required
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-slate-400">
                        {selectedProtocol === 'hysteria2' ? 'Client Auth Password' : 'UUID / Key'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setClientUuid(generateUUID())
                          setClientAuth(generatePassword(16))
                        }}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300"
                      >
                        {selectedProtocol === 'hysteria2' ? 'Gen Auth' : 'New UUID'}
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      value={selectedProtocol === 'hysteria2' ? clientAuth : clientUuid}
                      onChange={(e) => {
                        if (selectedProtocol === 'hysteria2') {
                          setClientAuth(e.target.value)
                        } else {
                          setClientUuid(e.target.value)
                        }
                      }}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {selectedProtocol === 'vless' && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Flow Control</label>
                    <select
                      value={clientFlow}
                      onChange={(e) => setClientFlow(e.target.value)}
                      className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    >
                      <option value="xtls-rprx-vision">xtls-rprx-vision (Recommended for Reality)</option>
                      <option value="">None</option>
                    </select>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-4 border-t border-[#2d3148] flex items-center justify-between">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow-lg shadow-indigo-600/20"
              >
                <span>Continue to Parameters</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition flex items-center space-x-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <button
                type="submit"
                form="inbound-form"
                disabled={loading}
                className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-2 shadow-lg shadow-indigo-600/20"
              >
                {loading && <Spinner size="xs" />}
                <span>Create & Deploy Inbound</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
