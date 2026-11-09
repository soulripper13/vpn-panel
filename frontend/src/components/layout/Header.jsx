import React from 'react'
import { Menu, LogOut, User, RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import api, { getBasePath } from '../../utils/api'
import toast from 'react-hot-toast'

export default function Header({ onMenuClick, wsConnected = false }) {
  const { user, logout } = useAuthStore()

  const handleApplyAll = async () => {
    try {
      toast.loading('Applying configs to sing-box and xray...', { id: 'apply' })
      const res = await api.post('/inbounds/apply')
      if (res.data.success) {
        toast.success('All configurations applied!', { id: 'apply' })
      } else {
        toast.error(res.data.message || 'Failed to apply', { id: 'apply' })
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message, { id: 'apply' })
    }
  }

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {}
    logout()
    const bp = getBasePath()
    window.location.href = `${bp}/login`
  }

  return (
    <header className="h-16 bg-[#14161f]/80 backdrop-blur-md border-b border-[#2d3148] px-4 lg:px-8 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center space-x-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span
          aria-live="polite"
          title={wsConnected ? 'Live dashboard updates are connected' : 'Live dashboard updates are reconnecting'}
          className={`text-xs font-medium px-2.5 py-1 rounded-full border ${wsConnected
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-amber-500/10 text-amber-300 border-amber-500/20'}`}
        >
          {wsConnected ? '● Live Sync' : '◌ Reconnecting'}
        </span>
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={handleApplyAll}
          className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Apply Configs</span>
        </button>

        <div className="flex items-center space-x-3 pl-3 border-l border-slate-800">
          <div className="flex items-center space-x-2 text-sm text-slate-300">
            <div className="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-semibold text-xs">
              <User className="w-4 h-4" />
            </div>
            <span className="hidden md:inline font-medium text-slate-200">{user?.username || 'admin'}</span>
          </div>

          <button
            onClick={handleLogout}
            title="Log out"
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-slate-700/60 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
