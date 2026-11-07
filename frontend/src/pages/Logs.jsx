import React, { useState, useEffect, useRef } from 'react'
import { ScrollText, RefreshCw, Trash2, ArrowDown } from 'lucide-react'
import api from '../utils/api'
import Spinner from '../components/ui/Spinner'
import Badge from '../components/ui/Badge'

export default function Logs() {
  const [engine, setEngine] = useState('singbox')
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const logEndRef = useRef(null)

  const fetchLogs = async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true)
      const res = await api.get(`/engine/${engine}/logs?lines=150`)
      if (res.data?.data?.logs) {
        setLogs(res.data.data.logs)
      } else {
        setLogs('No logs returned for this service.')
      }
    } catch (err) {
      setLogs(`Error retrieving logs: ${err.message}`)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs(true)
  }, [engine])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchLogs(false)
    }, 4000)
    return () => clearInterval(interval)
  }, [autoRefresh, engine])

  const scrollToBottom = () => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">System Logs</h2>
          <p className="text-xs text-slate-400">Live output from sing-box and xray system processes</p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Engine selector tabs */}
          <div className="flex items-center space-x-1 bg-[#1a1d27] border border-[#2d3148] rounded-xl p-1">
            <button
              onClick={() => setEngine('singbox')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                engine === 'singbox'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              sing-box
            </button>
            <button
              onClick={() => setEngine('xray')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                engine === 'xray'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              xray-core
            </button>
          </div>

          <button
            onClick={() => fetchLogs(true)}
            className="p-2 rounded-xl bg-[#1a1d27] border border-[#2d3148] text-slate-300 hover:text-white hover:bg-slate-800 transition"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={() => setLogs('')}
            className="p-2 rounded-xl bg-[#1a1d27] border border-[#2d3148] text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
            title="Clear display"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal View */}
      <div className="bg-[#0b0d13] border border-[#2d3148] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[650px]">
        {/* Terminal topbar */}
        <div className="bg-[#14161f] border-b border-[#2d3148] px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            <span className="text-xs font-mono text-slate-400 ml-3">
              {engine === 'singbox' ? '/usr/bin/sing-box' : '/usr/local/x-ui/bin/xray-linux-amd64'}
            </span>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <label className="flex items-center space-x-1.5 text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0"
              />
              <span>Auto-refresh (4s)</span>
            </label>
            <button
              onClick={scrollToBottom}
              className="text-slate-400 hover:text-white flex items-center space-x-1"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>Bottom</span>
            </button>
          </div>
        </div>

        {/* Log content */}
        <div className="flex-1 p-4 font-mono text-xs text-slate-300 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
          {loading && !logs ? (
            <div className="h-full flex items-center justify-center space-x-2 text-slate-500">
              <Spinner size="sm" />
              <span>Retrieving logs...</span>
            </div>
          ) : logs ? (
            logs
          ) : (
            <div className="text-slate-600 italic">No output received from {engine} service yet.</div>
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}
