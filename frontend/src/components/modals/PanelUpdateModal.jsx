import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  Shield,
  ArrowUpCircle,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  RefreshCw,
  GitCommit,
  ExternalLink,
} from 'lucide-react'
import api from '../../utils/api'
import toast from 'react-hot-toast'
import Spinner from '../ui/Spinner'

export default function PanelUpdateModal({ isOpen, onClose, panelInfo, onFinished }) {
  if (!isOpen) return null

  const [status, setStatus] = useState('idle') // idle | running | restarting | completed | failed
  const [step, setStep] = useState('init')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)

  const logContainerRef = useRef(null)
  const pollTimerRef = useRef(null)
  const reconnectTimerRef = useRef(null)

  // Auto-scroll logs terminal
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  // Start the update
  const startUpdate = async () => {
    try {
      setStatus('running')
      setProgress(5)
      setLogs(['[Starting] Connecting to update pipeline...'])
      setError(null)
      setReconnectAttempts(0)

      const res = await api.post('/engine/panel/update')
      if (!res.data.success) {
        throw new Error(res.data.message || 'Failed to start update')
      }

      // Start polling status
      pollStatus()
    } catch (err) {
      setStatus('failed')
      setError(err.response?.data?.message || err.message)
      setLogs((prev) => [...prev, `[ERROR] ${err.response?.data?.message || err.message}`])
    }
  }

  // Poll update progress
  const pollStatus = () => {
    clearInterval(pollTimerRef.current)
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await api.get('/engine/panel/update/status')
        if (res.data?.data) {
          const data = res.data.data
          setStatus(data.status || 'running')
          setStep(data.step || '')
          setProgress(data.progress || 0)
          if (Array.isArray(data.logs)) {
            setLogs(data.logs)
          }

          if (data.status === 'failed') {
            clearInterval(pollTimerRef.current)
            setError(data.error || 'Update failed during execution')
          } else if (data.status === 'restarting') {
            clearInterval(pollTimerRef.current)
            startReconnectionPolling()
          } else if (data.status === 'completed') {
            clearInterval(pollTimerRef.current)
            toast.success('VPN Panel updated successfully!')
            setTimeout(() => {
              window.location.reload()
            }, 1500)
          }
        }
      } catch (err) {
        // If request fails during running/restarting, the service might be restarting
        if (status === 'running' || status === 'restarting') {
          clearInterval(pollTimerRef.current)
          setStatus('restarting')
          startReconnectionPolling()
        }
      }
    }, 1000)
  }

  // Ping backend until it is back online
  const startReconnectionPolling = () => {
    setStatus('restarting')
    setStep('restarting')
    setProgress(98)
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] vpn-panel.service restarted. Waiting for web panel to respond...`,
    ])

    clearInterval(reconnectTimerRef.current)
    let attempts = 0
    reconnectTimerRef.current = setInterval(async () => {
      attempts += 1
      setReconnectAttempts(attempts)
      try {
        const res = await api.get('/settings', { timeout: 3000 })
        if (res.status === 200) {
          clearInterval(reconnectTimerRef.current)
          setStatus('completed')
          setProgress(100)
          setLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] Panel is back online! Refreshing interface...`,
          ])
          toast.success('Panel successfully updated to the latest version!')
          setTimeout(() => {
            window.location.reload()
          }, 2000)
        }
      } catch {
        // Still restarting
      }

      if (attempts > 60) {
        clearInterval(reconnectTimerRef.current)
        setStatus('failed')
        setError('Reconnection timed out. Please check "journalctl -u vpn-panel -f" on your server.')
      }
    }, 1500)
  }

  useEffect(() => {
    startUpdate()
    return () => {
      clearInterval(pollTimerRef.current)
      clearInterval(reconnectTimerRef.current)
    }
  }, [])

  const canClose = status === 'completed' || status === 'failed'

  const getStepLabel = () => {
    switch (step) {
      case 'backup':
        return 'Backing up panel database & configuration...'
      case 'download':
        return 'Downloading latest code package from GitHub...'
      case 'extract':
        return 'Extracting update package...'
      case 'deploy_files':
        return 'Deploying updated backend & frontend assets...'
      case 'dependencies':
        return 'Updating production npm packages...'
      case 'restarting':
        return 'Service restarting — reconnecting...'
      default:
        return 'Initializing update pipeline...'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2d3148]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">VPN Panel Self-Update</h3>
              <p className="text-xs text-slate-400">
                Updating from{' '}
                <span className="font-mono text-slate-300">
                  v{panelInfo?.currentVersion || '1.2.0'}
                </span>{' '}
                to{' '}
                <span className="font-mono text-indigo-300 font-semibold">
                  v{panelInfo?.latestVersion || 'latest'}
                </span>
              </p>
            </div>
          </div>

          {canClose && (
            <button
              onClick={() => {
                if (onFinished) onFinished()
                onClose()
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Status & Progress */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              {status === 'running' && <Spinner size="xs" />}
              {status === 'restarting' && <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin" />}
              {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {status === 'failed' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
              <span className="font-medium text-slate-200">{getStepLabel()}</span>
            </div>
            <span className="font-mono text-indigo-400 font-bold">{progress}%</span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-[#14161f] border border-[#2d3148] rounded-full h-2.5 overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                status === 'failed'
                  ? 'bg-rose-500'
                  : status === 'completed'
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-indigo-500 to-purple-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Live Terminal Log */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center space-x-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>Execution Logs</span>
            </div>
            {status === 'restarting' && (
              <span className="text-amber-400 font-mono text-[10px] animate-pulse">
                Pinging server (attempt {reconnectAttempts})...
              </span>
            )}
          </div>

          <div
            ref={logContainerRef}
            className="h-56 bg-[#0f1118] border border-[#2d3148] rounded-xl p-3 font-mono text-[11px] leading-relaxed text-slate-300 overflow-y-auto space-y-1 select-text scrollbar-thin scrollbar-thumb-slate-700"
          >
            {logs.length === 0 ? (
              <span className="text-slate-600">Waiting for logs...</span>
            ) : (
              logs.map((log, idx) => {
                const isError = log.includes('ERROR') || log.includes('failed')
                const isSuccess = log.includes('successfully') || log.includes('online')
                const isWarn = log.includes('Warning')
                return (
                  <div
                    key={idx}
                    className={`${
                      isError
                        ? 'text-rose-400'
                        : isSuccess
                        ? 'text-emerald-400'
                        : isWarn
                        ? 'text-amber-300'
                        : 'text-slate-300'
                    }`}
                  >
                    {log}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="pt-2 flex items-center justify-between border-t border-[#2d3148]">
          <div className="text-[11px] text-slate-500 flex items-center space-x-1">
            <span>Repo:</span>
            <a
              href="https://github.com/soulripper13/vpn-panel"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline flex items-center space-x-0.5"
            >
              <span>soulripper13/vpn-panel</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>

          {canClose ? (
            <button
              onClick={() => {
                if (onFinished) onFinished()
                onClose()
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
            >
              Close
            </button>
          ) : (
            <div className="text-[11px] text-slate-400 italic">
              Please keep this page open while updating...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
