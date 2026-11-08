import React, { useState, useEffect } from 'react'
import { X, Plus, Trash2, QrCode, Copy, Check, Users, User, Key, RefreshCw, Shield, Zap } from 'lucide-react'
import { generateUUID, generatePassword, generateHexPassword, extractSettings, extractHysteriaDetails } from '../../utils/links'
import { formatBytes } from '../../utils/format'
import api from '../../utils/api'
import toast from 'react-hot-toast'
import QRModal from './QRModal'
import Toggle from '../ui/Toggle'
import Spinner from '../ui/Spinner'

export default function ClientModal({ isOpen, onClose, inbound, onUpdate }) {
  const [clients, setClients] = useState(inbound?.clients || [])
  const [showAddForm, setShowAddForm] = useState(false)
  const [activeQR, setActiveQR] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [loading, setLoading] = useState(false)

  const { settings, streamSettings } = extractSettings(inbound)
  const isShadowtls = inbound?.type === 'shadowtls' || inbound?.protocol === 'shadowtls'
  const isVless = inbound?.type === 'vless' || inbound?.protocol === 'vless'
  const isVmess = inbound?.type === 'vmess' || inbound?.protocol === 'vmess'
  const isHysteria = inbound?.type === 'hysteria' || inbound?.type === 'hysteria2' || inbound?.protocol === 'hysteria' || inbound?.protocol === 'hysteria2'
  const hy2Details = isHysteria ? extractHysteriaDetails(inbound, settings, streamSettings, window.location.hostname || '') : null

  // New client form state
  const [newEmail, setNewEmail] = useState('')
  const [newUuid, setNewUuid] = useState(generateUUID())
  const [newPassword, setNewPassword] = useState(isShadowtls ? generateHexPassword(16) : generatePassword(16))
  const [newFlow, setNewFlow] = useState('xtls-rprx-vision')
  const [newRemark, setNewRemark] = useState('')

  useEffect(() => {
    setClients(inbound?.clients || [])
    if (isShadowtls) {
      setNewPassword(generateHexPassword(16))
    } else {
      setNewPassword(generatePassword(16))
    }
    setNewUuid(generateUUID())
  }, [inbound])

  if (!isOpen || !inbound) return null

  const handleToggleClient = async (client) => {
    try {
      const updatedEnable = client.enable === 1 ? 0 : 1
      await api.put(`/inbounds/${inbound.id}/clients/${client.id}`, {
        enable: updatedEnable,
      })
      setClients((prev) =>
        prev.map((c) => (c.id === client.id ? { ...c, enable: updatedEnable } : c))
      )
      toast.success(`Client ${updatedEnable ? 'enabled' : 'disabled'}`)
      if (onUpdate) onUpdate()
    } catch {
      toast.error('Failed to update client status')
    }
  }

  const handleDeleteClient = async (clientId) => {
    if (!confirm('Are you sure you want to delete this client?')) return
    try {
      await api.delete(`/inbounds/${inbound.id}/clients/${clientId}`)
      setClients((prev) => prev.filter((c) => c.id !== clientId))
      toast.success('Client deleted')
      if (onUpdate) onUpdate()
    } catch {
      toast.error('Failed to delete client')
    }
  }

  const handleCreateClient = async (e) => {
    e.preventDefault()
    if (!newEmail.trim()) {
      toast.error('Client username / email is required')
      return
    }

    try {
      setLoading(true)
      const res = await api.post(`/inbounds/${inbound.id}/clients`, {
        email: newEmail.trim(),
        uuid: newUuid,
        password: isShadowtls || isHysteria ? newPassword.trim() : (newPassword || newUuid),
        flow: isVless ? newFlow : '',
        remark: newRemark.trim(),
        enable: true,
      })

      if (res.data.success) {
        setClients((prev) => [...prev, res.data.data])
        toast.success(`Client "${newEmail}" added successfully`)
        setNewEmail('')
        setNewUuid(generateUUID())
        setNewPassword(isShadowtls ? generateHexPassword(16) : generatePassword(16))
        setNewRemark('')
        setShowAddForm(false)
        if (onUpdate) onUpdate()
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add client')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = (client) => {
    if (!client.link) return
    navigator.clipboard.writeText(client.link)
    setCopiedId(client.id)
    toast.success('Link copied!')
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2d3148]">
          <div className="flex items-center space-x-2.5">
            <Users className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-semibold text-white">
                Clients for {inbound.remark || inbound.tag}
              </h3>
              <p className="text-xs text-slate-400">
                Port {inbound.port} • {inbound.engine.toUpperCase()} • Protocol: <span className="text-indigo-400 font-mono uppercase">{inbound.type}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ShadowTLS Inbound Info Badge */}
        {isShadowtls && (
          <div className="mt-3 p-3 bg-purple-950/30 border border-purple-500/30 rounded-xl text-xs space-y-1">
            <div className="flex items-center space-x-1.5 text-purple-300 font-semibold">
              <Shield className="w-4 h-4" />
              <span>ShadowTLS v3 + Shadowsocks 2022 Detour</span>
            </div>
            <div className="text-[11px] text-slate-400 space-x-3 font-mono">
              <span>SNI: <strong className="text-slate-200">{settings.serverName || 'gateway.icloud.com'}</strong></span>
              <span>Cipher: <strong className="text-slate-200">{settings.ssMethod || '2022-blake3-aes-128-gcm'}</strong></span>
              <span>SS Key: <strong className="text-slate-200 truncate inline-block max-w-[120px] align-bottom">{settings.ssPassword || '(shared)'}</strong></span>
            </div>
          </div>
        )}

        {/* Hysteria 2 Anti-Censorship Info Badge */}
        {isHysteria && (
          <div className="mt-3 p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-amber-300 font-semibold">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Hysteria 2 Anti-Censorship Profile</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Russia TSPU & China GFW Ready
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-300 font-mono">
              <div className="bg-[#14161f] p-1.5 rounded border border-[#2d3148]">
                <span className="text-slate-500 block text-[10px]">Salamander Obfs</span>
                <span className={hy2Details?.obfsPassword ? "text-amber-300 font-medium truncate block" : "text-slate-400"}>
                  {hy2Details?.obfsPassword ? `Key: ${hy2Details.obfsPassword}` : 'Disabled'}
                </span>
              </div>
              <div className="bg-[#14161f] p-1.5 rounded border border-[#2d3148]">
                <span className="text-slate-500 block text-[10px]">Port Hopping</span>
                <span className={hy2Details?.ports ? "text-emerald-300 font-medium truncate block" : "text-slate-400"}>
                  {hy2Details?.ports || 'Single Port'}
                </span>
              </div>
              <div className="bg-[#14161f] p-1.5 rounded border border-[#2d3148]">
                <span className="text-slate-500 block text-[10px]">SNI (Cert)</span>
                <span className="text-indigo-300 truncate block">
                  {hy2Details?.sni || window.location.hostname || 'Server'}
                </span>
              </div>
              <div className="bg-[#14161f] p-1.5 rounded border border-[#2d3148]">
                <span className="text-slate-500 block text-[10px]">ALPN</span>
                <span className="text-purple-300 font-medium">
                  {hy2Details?.alpn || 'h3'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Client List */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {clients.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              No clients configured for this inbound listener.
            </div>
          ) : (
            clients.map((c) => (
              <div
                key={c.id}
                className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-indigo-500/30 transition"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="font-semibold text-sm text-slate-200 truncate">{c.email}</span>
                    {c.remark && (
                      <span className="text-xs text-slate-500 font-normal">({c.remark})</span>
                    )}
                  </div>

                  {/* Specific credential display */}
                  <div className="text-xs font-mono text-slate-400 truncate max-w-sm flex items-center space-x-1.5">
                    {isShadowtls ? (
                      <>
                        <span className="text-slate-500">Plugin Pass:</span>
                        <span className="text-purple-300 font-medium">{c.password || '—'}</span>
                      </>
                    ) : isHysteria ? (
                      <>
                        <span className="text-slate-500">Auth Key:</span>
                        <span className="text-amber-300 font-medium">{c.password || c.auth || c.uuid}</span>
                      </>
                    ) : isVless || isVmess ? (
                      <>
                        <span className="text-slate-500">UUID:</span>
                        <span className="text-indigo-300 font-medium">{c.uuid}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-500">Password:</span>
                        <span className="text-emerald-300 font-medium">{c.password || c.uuid}</span>
                      </>
                    )}
                  </div>

                  <p className="text-xs text-slate-500">
                    ↑ {formatBytes(c.up_bytes)} • ↓ {formatBytes(c.down_bytes)}
                  </p>
                </div>

                <div className="flex items-center space-x-2 self-end sm:self-center flex-shrink-0">
                  <Toggle
                    size="sm"
                    checked={c.enable === 1}
                    onChange={() => handleToggleClient(c)}
                  />

                  <button
                    onClick={() => handleCopyLink(c)}
                    title="Copy Link"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    {copiedId === c.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={() =>
                      setActiveQR({
                        title: c.email,
                        link: c.link,
                        clashYaml: c.clashYaml,
                        singboxJson: c.singboxJson,
                        client: c,
                      })
                    }
                    title="QR Code & Config Exporters"
                    className="p-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 transition"
                  >
                    <QrCode className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleDeleteClient(c.id)}
                    title="Delete Client"
                    className="p-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add client section */}
        {showAddForm ? (
          <form onSubmit={handleCreateClient} className="p-4 bg-[#14161f] border border-[#2d3148] rounded-xl space-y-3 mt-2">
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center space-x-1.5">
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Add New Client to {inbound.remark || inbound.tag}</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Client Email / Label *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MegaFon-User or user1"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Remark / Description (optional)</label>
                <input
                  type="text"
                  placeholder="Phone, OpenWRT, etc."
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Protocol-specific credential inputs */}
            {isShadowtls ? (
              <div className="p-3 bg-[#1a1d27] border border-purple-500/30 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-purple-300 font-medium">Shadow-TLS Plugin Password (32 Hex)</label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generateHexPassword(16))}
                    className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center space-x-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Regen</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                />
                <p className="text-[11px] text-slate-400">
                  This 32-hex password will be used under <code className="text-purple-300">plugin-opts.password</code> in Clash and by Shadow-TLS clients.
                </p>
              </div>
            ) : isHysteria ? (
              <div className="p-3 bg-[#1a1d27] border border-amber-500/30 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-amber-300 font-medium">Hysteria 2 Auth Password</label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generatePassword(16))}
                    className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center space-x-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Regen</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                />
                <p className="text-[11px] text-slate-400">
                  Client authentication credential for Hysteria 2. Automatically inherits Salamander obfs {hy2Details?.obfsPassword ? 'key' : ''} and port hopping ({hy2Details?.ports || '20000-50000'}).
                </p>
              </div>
            ) : isVless || isVmess ? (
              <div className="p-3 bg-[#1a1d27] border border-indigo-500/30 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-indigo-300 font-medium">Client UUID</label>
                  <button
                    type="button"
                    onClick={() => setNewUuid(generateUUID())}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Regen</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={newUuid}
                  onChange={(e) => setNewUuid(e.target.value)}
                  className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <div className="p-3 bg-[#1a1d27] border border-[#2d3148] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">Password / Auth Key</label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generatePassword(16))}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Regen</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5"
              >
                {loading && <Spinner size="xs" />}
                <span>Save Client</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="pt-3 border-t border-[#2d3148] flex justify-between items-center">
            <button
              onClick={() => {
                if (isShadowtls) {
                  setNewPassword(generateHexPassword(16))
                } else {
                  setNewPassword(generatePassword(16))
                }
                setNewUuid(generateUUID())
                setShowAddForm(true)
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Client</span>
            </button>

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {activeQR && (
        <QRModal
          isOpen={Boolean(activeQR)}
          onClose={() => setActiveQR(null)}
          title={`Subscription — ${activeQR.title}`}
          link={activeQR.link}
          clashYaml={activeQR.clashYaml}
          singboxJson={activeQR.singboxJson}
          inbound={inbound}
          client={activeQR.client}
        />
      )}
    </div>
  )
}
