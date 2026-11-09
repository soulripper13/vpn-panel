import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Users,
  Search,
  QrCode,
  Copy,
  Check,
  Plus,
  Trash2,
  X,
  User,
  Shield,
  Zap,
  RefreshCw,
  Pencil,
} from 'lucide-react'
import api from '../utils/api'
import Badge from '../components/ui/Badge'
import QRModal from '../components/modals/QRModal'
import EditClientModal from '../components/modals/EditClientModal'
import Spinner from '../components/ui/Spinner'
import Toggle from '../components/ui/Toggle'
import { formatBytes } from '../utils/format'
import { generateUUID, generatePassword, generateHexPassword } from '../utils/links'
import toast from 'react-hot-toast'

export default function Clients() {
  const [search, setSearch] = useState('')
  const [activeQR, setActiveQR] = useState(null)
  const [editingClient, setEditingClient] = useState(null)
  const [copiedEmail, setCopiedEmail] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)

  // Add Client Form state
  const [selectedInboundId, setSelectedInboundId] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientUuid, setClientUuid] = useState(generateUUID())
  const [clientPassword, setClientPassword] = useState(generateHexPassword(16))
  const [clientFlow, setClientFlow] = useState('xtls-rprx-vision')
  const [clientRemark, setClientRemark] = useState('')
  const [clientTrafficLimitGb, setClientTrafficLimitGb] = useState(0)
  const [clientExpiryDays, setClientExpiryDays] = useState(0)
  const [createLoading, setCreateLoading] = useState(false)

  const queryClient = useQueryClient()

  const inboundsQuery = useQuery({
    queryKey: ['inbounds', 'all-clients'],
    queryFn: async () => {
      const res = await api.get('/inbounds')
      return res.data.data
    },
    refetchInterval: 5000,
  })

  const inbounds = inboundsQuery.data || []

  // Flatten all clients with parent inbound details
  const allClients = inbounds.flatMap((inb) =>
    (inb.clients || []).map((c) => ({
      ...c,
      inboundId: inb.id,
      inboundRemark: inb.remark || inb.tag,
      inboundEngine: inb.engine,
      inboundProtocol: inb.protocol || inb.type,
      inboundPort: inb.port,
    }))
  )

  const filteredClients = allClients.filter((c) => {
    if (!search.trim()) return true
    const term = search.toLowerCase()
    return (
      c.email?.toLowerCase().includes(term) ||
      c.remark?.toLowerCase().includes(term) ||
      c.inboundRemark?.toLowerCase().includes(term) ||
      String(c.inboundPort).includes(term)
    )
  })

  const handleCopyLink = async (c) => {
    try {
      let link = c.link
      if (!link) {
        const res = await api.post(`/inbounds/${c.inboundId}/clients/${c.id}/reveal`)
        link = res.data?.data?.link
      }
      if (link) {
        await navigator.clipboard.writeText(link)
        setCopiedEmail(c.email)
        toast.success('Link copied to clipboard')
        setTimeout(() => setCopiedEmail(null), 2000)
      } else {
        toast.error('No configuration link available')
      }
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const handleOpenQR = async (c) => {
    const parentInbound = inbounds.find((i) => i.id === c.inboundId)
    try {
      const res = await api.post(`/inbounds/${c.inboundId}/clients/${c.id}/reveal`)
      const data = res.data.data
      setActiveQR({
        title: `${c.email} (${c.inboundRemark})`,
        link: data.link,
        clashYaml: data.clashYaml,
        singboxJson: data.singboxJson,
        inbound: parentInbound,
        client: { ...data, ...(c.subUrl ? { subUrl: c.subUrl } : {}) },
      })
    } catch (err) {
      toast.error('Failed to load client credentials: ' + (err.response?.data?.message || err.message))
    }
  }

  const handleRotateSubToken = async (c) => {
    if (!confirm(`Rotate subscription token for "${c.email}"? Any previously issued subscription links will immediately stop working.`)) return
    try {
      const revealRes = await api.post(`/inbounds/${c.inboundId}/clients/${c.id}/reveal`)
      const rotateRes = await api.post(`/inbounds/${c.inboundId}/clients/${c.id}/rotate-sub-token`)
      const subUrl = rotateRes.data?.data?.subUrl
      const client = { ...revealRes.data.data, ...(subUrl ? { subUrl } : {}) }
      const parentInbound = inbounds.find((inbound) => inbound.id === c.inboundId)

      setActiveQR({
        title: `${c.email} (${c.inboundRemark})`,
        link: client.link,
        clashYaml: client.clashYaml,
        singboxJson: client.singboxJson,
        inbound: parentInbound,
        client,
      })
      queryClient.invalidateQueries({ queryKey: ['inbounds'] })
      if (subUrl) {
        try {
          await navigator.clipboard.writeText(subUrl)
          toast.success('New subscription URL copied; its QR code is ready.')
        } catch {
          toast.success('New subscription QR is ready. Clipboard access was unavailable.')
        }
      }
    } catch {
      toast.error('Failed to rotate subscription token')
    }
  }

  const handleToggleClient = async (c) => {
    try {
      const updatedEnable = c.enable === 1 ? 0 : 1
      await api.put(`/inbounds/${c.inboundId}/clients/${c.id}`, {
        enable: updatedEnable,
      })
      queryClient.invalidateQueries({ queryKey: ['inbounds'] })
      toast.success(`Client ${updatedEnable ? 'enabled' : 'disabled'}`)
    } catch {
      toast.error('Failed to update client status')
    }
  }

  const handleDeleteClient = async (c) => {
    if (!confirm(`Delete client "${c.email}" from inbound ${c.inboundRemark}?`)) return
    try {
      await api.delete(`/inbounds/${c.inboundId}/clients/${c.id}`)
      queryClient.invalidateQueries({ queryKey: ['inbounds'] })
      toast.success('Client deleted')
    } catch {
      toast.error('Failed to delete client')
    }
  }

  const handleCreateClient = async (e) => {
    e.preventDefault()
    const targetInboundId = selectedInboundId || inbounds[0]?.id
    if (!targetInboundId) {
      toast.error('Please create an inbound first before adding clients')
      return
    }

    if (!clientEmail.trim()) {
      toast.error('Client username / email is required')
      return
    }

    try {
      setCreateLoading(true)
      const bytesLimit = clientTrafficLimitGb > 0 ? clientTrafficLimitGb * 1024 * 1024 * 1024 : 0
      const expiryEpoch = clientExpiryDays > 0 ? Math.floor(Date.now() / 1000) + clientExpiryDays * 86400 : 0

      const targetInbound = inbounds.find((i) => i.id === parseInt(targetInboundId, 10))
      const isTargetStls = targetInbound?.type === 'shadowtls' || targetInbound?.protocol === 'shadowtls'
      const isTargetHy2 = targetInbound?.type === 'hysteria2' || targetInbound?.protocol === 'hysteria2' || targetInbound?.type === 'hysteria' || targetInbound?.protocol === 'hysteria'
      const finalPassword = isTargetStls || isTargetHy2 ? clientPassword.trim() : (clientPassword || clientUuid)

      const res = await api.post(`/inbounds/${targetInboundId}/clients`, {
        email: clientEmail.trim(),
        uuid: clientUuid,
        password: finalPassword,
        flow: clientFlow,
        remark: clientRemark,
        total_bytes_limit: bytesLimit,
        expiry_time: expiryEpoch,
        enable: true,
      })

      if (res.data.success) {
        toast.success(`Client ${clientEmail} added to inbound!`)
        setActiveQR({
          title: clientEmail,
          link: res.data.data.link,
          clashYaml: res.data.data.clashYaml,
          singboxJson: res.data.data.singboxJson,
          inbound: targetInbound,
          client: res.data.data,
        })
        queryClient.invalidateQueries({ queryKey: ['inbounds'] })
        setShowAddModal(false)
        setClientEmail('')
        setClientUuid(generateUUID())
        setClientPassword(generateHexPassword(16))
        setClientRemark('')
        setClientTrafficLimitGb(0)
        setClientExpiryDays(0)
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add client')
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Clients & Users Directory</h2>
          <p className="text-xs text-slate-400">Manage client accounts, UUIDs, keys, and subscription links across both engines</p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Search */}
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search user, tag, port..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition shadow"
            />
          </div>

          <button
            onClick={() => {
              if (inbounds.length > 0 && !selectedInboundId) {
                setSelectedInboundId(inbounds[0].id)
              }
              setShowAddModal(true)
            }}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition flex items-center space-x-1.5 shadow-lg shadow-indigo-600/20 flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Client</span>
          </button>
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl shadow-lg overflow-hidden">
        {inboundsQuery.isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <Spinner size="lg" />
            <p className="text-xs text-slate-400">Loading clients...</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Users className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-sm font-medium text-slate-400">No clients found</p>
            <p className="text-xs text-slate-500">Click "Add Client" above to create an account on an inbound listener.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#14161f] text-slate-400 uppercase tracking-wider font-semibold border-b border-[#2d3148]">
                <tr>
                  <th className="px-5 py-3">Client Email</th>
                  <th className="px-5 py-3">Inbound Target</th>
                  <th className="px-5 py-3">Core</th>
                  <th className="px-5 py-3">Port</th>
                  <th className="px-5 py-3">Traffic</th>
                  <th className="px-5 py-3 text-center">Active</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d3148]">
                {filteredClients.map((c) => (
                  <tr key={`${c.inboundId}-${c.id}`} className="hover:bg-slate-800/30 transition">
                    <td className="px-5 py-4 font-semibold text-white">
                      <div className="flex items-center space-x-2">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{c.email}</span>
                      </div>
                      {c.remark && <div className="text-[11px] text-slate-500 font-normal pl-5">{c.remark}</div>}
                      <div className="pl-5 pt-1 text-[11px] font-mono text-slate-400">
                        {c.inboundProtocol === 'hysteria2' || c.inboundProtocol === 'hysteria' ? (
                          <span className="text-amber-300">Auth: {c.password || c.auth || c.uuid}</span>
                        ) : c.inboundProtocol === 'shadowtls' ? (
                          <span className="text-purple-300">Pass: {c.password || '—'}</span>
                        ) : c.inboundProtocol === 'vless' || c.inboundProtocol === 'vmess' ? (
                          <span className="text-indigo-300">UUID: {c.uuid}</span>
                        ) : (
                          <span className="text-emerald-300">Key: {c.password || c.uuid}</span>
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-4 text-slate-300">
                      <div>{c.inboundRemark}</div>
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        <span className="text-[10px] text-indigo-400 uppercase font-mono">{c.inboundProtocol}</span>
                        {(c.inboundProtocol === 'hysteria2' || c.inboundProtocol === 'hysteria') && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            QUIC Hop
                          </span>
                        )}
                        {c.inboundProtocol === 'shadowtls' && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            TLS Detour
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <Badge variant={c.inboundEngine === 'singbox' ? 'singbox' : 'xray'}>
                        {c.inboundEngine}
                      </Badge>
                    </td>

                    <td className="px-5 py-4 font-mono text-indigo-300 font-medium">
                      {c.inboundPort}
                    </td>

                    <td className="px-5 py-4 font-mono text-slate-300">
                      <div>↑ {formatBytes(c.up_bytes)}</div>
                      <div className="text-slate-500">↓ {formatBytes(c.down_bytes)}</div>
                    </td>

                    <td className="px-5 py-4 text-center">
                      <Toggle
                        size="sm"
                        checked={c.enable === 1 || c.enable === true}
                        onChange={() => handleToggleClient(c)}
                      />
                    </td>

                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => setEditingClient(c)}
                          title="Edit Client Settings"
                          className="p-1.5 rounded-lg bg-amber-600/15 hover:bg-amber-600/25 text-amber-300 transition"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleCopyLink(c)}
                          title="Copy Link (Reveals on demand)"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                        >
                          {copiedEmail === c.email ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleOpenQR(c)}
                          title="Show QR Code & Subscription"
                          className="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 transition"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRotateSubToken(c)}
                          title="Rotate Subscription Token (Invalidates old link)"
                          className="p-1.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 transition"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClient(c)}
                          title="Delete Client"
                          className="p-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600/25 text-rose-300 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Client Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#2d3148]">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-semibold text-white">Add Client to Inbound</h3>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="space-y-4">
              {/* Inbound selector */}
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Target Inbound Listener</label>
                <select
                  required
                  value={selectedInboundId}
                  onChange={(e) => setSelectedInboundId(e.target.value)}
                  className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                >
                  {inbounds.map((inb) => (
                    <option key={inb.id} value={inb.id}>
                      [{inb.engine.toUpperCase()}] {inb.remark || inb.tag} — Port {inb.port} ({inb.protocol || inb.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Username / Email</label>
                  <input
                    type="text"
                    required
                    placeholder="alice"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Remark (Optional)</label>
                  <input
                    type="text"
                    placeholder="iPhone / Laptop"
                    value={clientRemark}
                    onChange={(e) => setClientRemark(e.target.value)}
                    className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {(() => {
                const targetInb = inbounds.find((i) => i.id === parseInt(selectedInboundId || inbounds[0]?.id, 10))
                const isStls = targetInb?.type === 'shadowtls' || targetInb?.protocol === 'shadowtls'
                const isHy2 = targetInb?.type === 'hysteria2' || targetInb?.protocol === 'hysteria2' || targetInb?.type === 'hysteria' || targetInb?.protocol === 'hysteria'

                if (isStls) {
                  return (
                    <div className="p-3 bg-[#14161f] border border-purple-500/30 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-purple-300">Shadow-TLS Plugin Password (32 Hex)</label>
                        <button
                          type="button"
                          onClick={() => setClientPassword(generateHexPassword(16))}
                          className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center space-x-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Randomize</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        value={clientPassword}
                        onChange={(e) => setClientPassword(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                      />
                      <p className="text-[11px] text-slate-400">
                        This plugin password will be used under <code className="text-purple-300 font-mono">plugin-opts.password</code> in OpenClash / Clash Meta.
                      </p>
                    </div>
                  )
                }

                if (isHy2) {
                  return (
                    <div className="p-3 bg-[#14161f] border border-amber-500/30 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-amber-300">Hysteria 2 Auth Password</label>
                        <button
                          type="button"
                          onClick={() => setClientPassword(generatePassword(16))}
                          className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center space-x-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Randomize</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        value={clientPassword}
                        onChange={(e) => setClientPassword(e.target.value)}
                        className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                      />
                      <p className="text-[11px] text-slate-400">
                        Client authentication key. Inherits Salamander obfuscation and port hopping from listener [{targetInb?.remark || targetInb?.tag}].
                      </p>
                    </div>
                  )
                }

                return (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-300">UUID / Password</label>
                      <button
                        type="button"
                        onClick={() => {
                          setClientUuid(generateUUID())
                          setClientPassword(generatePassword(16))
                        }}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300"
                      >
                        Randomize
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      value={clientUuid}
                      onChange={(e) => {
                        setClientUuid(e.target.value)
                        setClientPassword(e.target.value)
                      }}
                      className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Traffic Quota (GB, 0 = Unlimited)</label>
                  <input
                    type="number"
                    min="0"
                    value={clientTrafficLimitGb}
                    onChange={(e) => setClientTrafficLimitGb(parseInt(e.target.value || 0, 10))}
                    className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Validity (Days, 0 = Never)</label>
                  <input
                    type="number"
                    min="0"
                    value={clientExpiryDays}
                    onChange={(e) => setClientExpiryDays(parseInt(e.target.value || 0, 10))}
                    className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#2d3148]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
                >
                  {createLoading && <Spinner size="xs" />}
                  <span>Save Client</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {activeQR && (
        <QRModal
          isOpen={Boolean(activeQR)}
          onClose={() => setActiveQR(null)}
          title={`Subscription — ${activeQR.title}`}
          link={activeQR.link}
          clashYaml={activeQR.clashYaml}
          singboxJson={activeQR.singboxJson}
          inbound={activeQR.inbound}
          client={activeQR.client}
        />
      )}

      {/* Edit Client Modal */}
      <EditClientModal
        isOpen={Boolean(editingClient)}
        onClose={() => setEditingClient(null)}
        client={editingClient}
        inbound={inbounds?.find((i) => i.id === editingClient?.inboundId || i.id === editingClient?.inbound_id)}
        onSuccess={() => queryClient.invalidateQueries(['inbounds'])}
      />
    </div>
  )
}
