import React, { useState } from 'react'
import { Play, Square, RotateCw, ArrowUpCircle } from 'lucide-react'
import StatusDot from './StatusDot'
import Badge from './Badge'
import Spinner from './Spinner'
import api from '../../utils/api'
import toast from 'react-hot-toast'

export default function EngineCard({ name, title, status, onAction }) {
  const [loading, setLoading] = useState(false)
  const [updateLoading, setUpdateLoading] = useState(false)
  const isRunning = Boolean(status?.running)

  const handleAction = async (action) => {
    try {
      setLoading(true)
      await onAction(name, action)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateBinary = async () => {
    if (!confirm(`Check GitHub and update ${title} binary to the latest release?`)) return
    try {
      setUpdateLoading(true)
      const res = await api.post(`/engine/${name}/update`)
      if (res.data.success) {
        toast.success(res.data.message || `${title} binary updated successfully!`)
        if (onAction) await onAction(name, 'restart')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to update ${name} binary`)
    } finally {
      setUpdateLoading(false)
    }
  }

  return (
    <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <StatusDot active={isRunning} />
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-semibold text-white tracking-wide">{title}</h3>
              <Badge variant={name === 'singbox' ? 'singbox' : 'xray'} size="xs">
                {name === 'singbox' ? 'sing-box' : 'xray-core'}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              {isRunning ? `v${status?.version || '1.0'} • PID ${status?.pid || '-'}` : 'Service Stopped'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            disabled={loading || updateLoading}
            onClick={handleUpdateBinary}
            title={`Check and update ${title} binary from GitHub`}
            className="p-2 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-300 transition border border-indigo-800/40 flex items-center justify-center"
          >
            {updateLoading ? <Spinner size="sm" /> : <ArrowUpCircle className="w-4 h-4 text-indigo-400" />}
          </button>

          {isRunning ? (
            <>
              <button
                disabled={loading || updateLoading}
                onClick={() => handleAction('restart')}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition border border-slate-700 flex items-center justify-center"
                title="Restart Service"
              >
                {loading ? <Spinner size="sm" /> : <RotateCw className="w-4 h-4 text-indigo-400" />}
              </button>
              <button
                disabled={loading || updateLoading}
                onClick={() => handleAction('stop')}
                className="p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 transition border border-rose-800/40 flex items-center justify-center"
                title="Stop Service"
              >
                {loading ? <Spinner size="sm" /> : <Square className="w-4 h-4" />}
              </button>
            </>
          ) : (
            <button
              disabled={loading || updateLoading}
              onClick={() => handleAction('start')}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition flex items-center space-x-1.5 shadow"
            >
              {loading ? <Spinner size="sm" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>Start</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
        <div>
          <span className="text-slate-500 block">Memory:</span>
          <span className="font-medium text-slate-300">{status?.memory || (isRunning ? 'Active' : '0 MB')}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Uptime:</span>
          <span className="font-medium text-slate-300">{status?.uptime || (isRunning ? 'Online' : 'Stopped')}</span>
        </div>
      </div>
    </div>
  )
}
