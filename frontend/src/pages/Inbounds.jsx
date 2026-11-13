import React, { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Plus,
  Search,
  Filter,
  Users,
  UserPlus,
  QrCode,
  Trash2,
  RotateCcw,
  Radio,
  ExternalLink,
  Pencil,
} from 'lucide-react'
import { useInbounds } from '../hooks/useInbounds'
import Badge from '../components/ui/Badge'
import Toggle from '../components/ui/Toggle'
import Spinner from '../components/ui/Spinner'
import AddInboundModal from '../components/modals/AddInboundModal'
import EditInboundModal from '../components/modals/EditInboundModal'
import ClientModal from '../components/modals/ClientModal'
import QRModal from '../components/modals/QRModal'
import { formatBytes } from '../utils/format'

export default function Inbounds() {
  const location = useLocation()
  const [engineFilter, setEngineFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [prefillSni, setPrefillSni] = useState(null)
  const [prefillDest, setPrefillDest] = useState(null)
  const [editingInbound, setEditingInbound] = useState(null)
  const [clientModalInbound, setClientModalInbound] = useState(null)
  const [qrModalData, setQrModalData] = useState(null)

  useEffect(() => {
    if (location.state?.prefillSni) {
      setPrefillSni(location.state.prefillSni)
      setPrefillDest(location.state.prefillDest || `${location.state.prefillSni}:443`)
      setIsAddOpen(true)
    }
  }, [location.state])

  const {
    inbounds,
    isLoading,
    refetch,
    toggleInbound,
    deleteInbound,
    resetTraffic,
  } = useInbounds(engineFilter === 'all' ? undefined : engineFilter)

  const filteredInbounds = inbounds.filter((inb) => {
    if (!search.trim()) return true
    const term = search.toLowerCase()
    return (
      inb.remark?.toLowerCase().includes(term) ||
      inb.tag?.toLowerCase().includes(term) ||
      inb.type?.toLowerCase().includes(term) ||
      String(inb.port).includes(term)
    )
  })

  return (
    <div className="space-y-6">
      {/* Title & Add button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Inbound Management</h2>
          <p className="text-xs text-slate-400">Configure listening ports and protocols for sing-box and xray</p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition flex items-center space-x-2 shadow-lg shadow-indigo-600/20 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Inbound</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#1a1d27] border border-[#2d3148] rounded-xl p-3">
        {/* Engine filter pills */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setEngineFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              engineFilter === 'all'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            All Cores
          </button>
          <button
            onClick={() => setEngineFilter('singbox')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center space-x-1.5 ${
              engineFilter === 'singbox'
                ? 'bg-purple-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span>sing-box</span>
          </button>
          <button
            onClick={() => setEngineFilter('xray')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center space-x-1.5 ${
              engineFilter === 'xray'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span>Xray</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search remark, protocol, port..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>
      </div>

      {/* Inbounds Table */}
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <Spinner size="lg" />
            <p className="text-xs text-slate-400">Loading inbounds...</p>
          </div>
        ) : filteredInbounds.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Radio className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-sm font-medium text-slate-400">No inbounds found</p>
            <p className="text-xs text-slate-500">Click "Add Inbound" above to create your first proxy listener.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#14161f] text-slate-400 uppercase tracking-wider font-semibold border-b border-[#2d3148]">
                <tr>
                  <th className="px-5 py-3">Remark</th>
                  <th className="px-5 py-3">Core</th>
                  <th className="px-5 py-3">Protocol</th>
                  <th className="px-5 py-3">Port</th>
                  <th className="px-5 py-3">Traffic</th>
                  <th className="px-5 py-3">Clients</th>
                  <th className="px-5 py-3 text-center">Active</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d3148]">
                {filteredInbounds.map((inb) => (
                  <tr key={inb.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-5 py-4 font-semibold text-white">
                      <div>{inb.remark || inb.tag}</div>
                      <div className="text-[11px] font-normal text-slate-500 font-mono">{inb.tag}</div>
                    </td>

                    <td className="px-5 py-4">
                      <Badge variant={inb.engine === 'singbox' ? 'singbox' : 'xray'}>
                        {inb.engine}
                      </Badge>
                    </td>

                    <td className="px-5 py-4">
                      <span className="font-medium text-slate-300 uppercase tracking-wide">
                        {inb.protocol || inb.type}
                      </span>
                    </td>

                    <td className="px-5 py-4 font-mono text-indigo-300 font-medium">
                      {inb.port}
                    </td>

                    <td className="px-5 py-4 font-mono text-slate-300">
                      <div>↑ {formatBytes(inb.up_bytes)}</div>
                      <div className="text-slate-500">↓ {formatBytes(inb.down_bytes)}</div>
                    </td>

                    <td className="px-5 py-4">
                      <button
                        onClick={() => setClientModalInbound(inb)}
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
                      >
                        <Users className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{inb.clientCount || 0}</span>
                      </button>
                    </td>

                    <td className="px-5 py-4 text-center">
                      <Toggle
                        size="sm"
                        checked={inb.enabled === 1 || inb.enabled === true}
                        onChange={() => toggleInbound(inb.id)}
                      />
                    </td>

                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => setEditingInbound(inb)}
                          title="Edit Inbound Settings"
                          className="p-1.5 rounded-lg bg-amber-600/15 hover:bg-amber-600/25 text-amber-300 transition"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => setClientModalInbound(inb)}
                          title="Manage / Add Clients"
                          className="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 transition"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>

                        {inb.clients?.[0] && (
                          <button
                            onClick={async () => {
                              try {
                                const c = inb.clients[0]
                                const res = await api.post(`/inbounds/${inb.id}/clients/${c.id}/reveal`)
                                const data = res.data.data
                                setQrModalData({
                                  title: inb.remark || inb.tag,
                                  link: data.link,
                                  clashYaml: data.clashYaml,
                                  singboxJson: data.singboxJson,
                                  inbound: inb,
                                  client: data,
                                })
                              } catch (err) {
                                toast.error('Failed to load credentials: ' + (err.response?.data?.message || err.message))
                              }
                            }}
                            title="Show QR Code"
                            className="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 transition"
                          >
                            <QrCode className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          onClick={() => resetTraffic(inb.id)}
                          title="Reset Traffic Stats"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => {
                            if (confirm(`Delete inbound ${inb.remark || inb.tag}?`)) {
                              deleteInbound(inb.id)
                            }
                          }}
                          title="Delete Inbound"
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

      {/* Add Modal */}
      <AddInboundModal
        isOpen={isAddOpen}
        prefillSni={prefillSni}
        prefillDest={prefillDest}
        onClose={() => {
          setIsAddOpen(false)
          setPrefillSni(null)
          setPrefillDest(null)
        }}
        onSuccess={(created) => {
          refetch()
          const initialClient = created?.initialClient
          if (initialClient) {
            setQrModalData({
              title: `New client — ${initialClient.email}`,
              link: initialClient.link,
              clashYaml: initialClient.clashYaml,
              singboxJson: initialClient.singboxJson,
              inbound: created,
              client: initialClient,
            })
          }
        }}
      />

      {/* Edit Inbound Modal */}
      <EditInboundModal
        isOpen={Boolean(editingInbound)}
        onClose={() => setEditingInbound(null)}
        inbound={editingInbound}
        onSuccess={refetch}
      />

      {/* Clients Modal */}
      <ClientModal
        isOpen={Boolean(clientModalInbound)}
        onClose={() => setClientModalInbound(null)}
        inbound={clientModalInbound}
        onUpdate={refetch}
      />

      {/* QR Modal */}
      <QRModal
        isOpen={Boolean(qrModalData)}
        onClose={() => setQrModalData(null)}
        title={qrModalData?.title}
        link={qrModalData?.link}
        clashYaml={qrModalData?.clashYaml}
        singboxJson={qrModalData?.singboxJson}
        inbound={qrModalData?.inbound}
        client={qrModalData?.client}
      />
    </div>
  )
}
