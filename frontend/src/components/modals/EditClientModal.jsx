import React, { useState } from 'react'
import {
  X,
  Check,
  User,
  Key,
  RefreshCw,
  Zap,
  Shield,
  Clock,
  HardDrive,
  Sliders,
} from 'lucide-react'
import { generateUUID, generatePassword, generateHexPassword } from '../../utils/links'
import api from '../../utils/api'
import toast from 'react-hot-toast'
import Spinner from '../ui/Spinner'
import Toggle from '../ui/Toggle'

export default function EditClientModal({ isOpen, onClose, client, inbound, onSuccess }) {
  if (!isOpen || !client) return null

  const inboundId = client.inbound_id || inbound?.id
  const protocol = (inbound?.protocol || inbound?.type || client.inboundProtocol || '').toLowerCase()
  const isVlessOrVmess = protocol === 'vless' || protocol === 'vmess'
  const isShadowtls = protocol === 'shadowtls'

  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState(client.email || '')
  const [remark, setRemark] = useState(client.remark || '')
  const [uuid, setUuid] = useState(client.uuid || '')
  const [password, setPassword] = useState(client.password || '')
  const [flow, setFlow] = useState(client.flow || '')
  const [limitGb, setLimitGb] = useState(
    client.total_bytes_limit ? Math.round(client.total_bytes_limit / (1024 * 1024 * 1024)) : 0
  )
  const [expiryDays, setExpiryDays] = useState(0)
  const [enable, setEnable] = useState(client.enable === 1 || client.enable === true)

  const handleSave = async (e) => {
    e.preventDefault()

    try {
      setLoading(true)

      const payload = {
        email,
        remark,
        uuid: uuid || client.uuid,
        password: password || client.password,
        flow,
        total_bytes_limit: limitGb ? parseInt(limitGb, 10) * 1024 * 1024 * 1024 : 0,
        enable,
      }

      if (expiryDays) {
        payload.expiry_time = Math.floor(Date.now() / 1000) + parseInt(expiryDays, 10) * 86400
      } else if (client.expiry_time) {
        payload.expiry_time = client.expiry_time
      } else {
        payload.expiry_time = 0
      }

      const res = await api.put(`/inbounds/${inboundId}/clients/${client.id}`, payload)
      if (res.data.success) {
        toast.success(`Client ${email} updated successfully!`)
        onSuccess()
        onClose()
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update client')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col max-h-[92vh] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2d3148]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
              <User className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Edit Client: {client.email}</h3>
              <p className="text-xs text-slate-400">
                {inbound ? `Inbound: ${inbound.remark || inbound.tag} (Port ${inbound.port})` : 'Update client credentials & quotas'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Email & Remark */}
          <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Client Email / Label *</label>
                <input
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Remark / Description</label>
                <input
                  type="text"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="e.g. Phone, iPad, OpenWRT"
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Credentials: Password or UUID */}
            {isVlessOrVmess ? (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-400">Client UUID *</label>
                  <button
                    type="button"
                    onClick={() => setUuid(generateUUID())}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Generate New UUID</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={uuid}
                  onChange={(e) => setUuid(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-slate-400">
                    {isShadowtls ? 'Shadow-TLS Client Password *' : 'Client Password *'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setPassword(isShadowtls ? generateHexPassword(16) : generatePassword(16))}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Random</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {/* Flow for Reality */}
            {protocol === 'vless' && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">Flow</label>
                <select
                  value={flow}
                  onChange={(e) => setFlow(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="xtls-rprx-vision">xtls-rprx-vision (Recommended for Reality)</option>
                  <option value="">none</option>
                </select>
              </div>
            )}
          </div>

          {/* Quotas & Expiration */}
          <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Limits & Account Status</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Traffic Limit (GB, 0 = unlimited)</label>
                <input
                  type="number"
                  min="0"
                  value={limitGb}
                  onChange={(e) => setLimitGb(e.target.value)}
                  className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Extend Expiry (+Days, 0 = keep current)</label>
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

            <div className="flex items-center justify-between pt-2 border-t border-[#2d3148]">
              <span className="text-xs text-slate-300">Client Status (Enabled / Active)</span>
              <Toggle checked={enable} onChange={setEnable} size="sm" />
            </div>
          </div>

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
              <span>Save Client Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
