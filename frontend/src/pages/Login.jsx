import React, { useState } from 'react'
import { Shield, Lock, User, Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import api, { getBasePath } from '../utils/api'
import Spinner from '../components/ui/Spinner'
import toast from 'react-hot-toast'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      toast.error('Please enter both username and password')
      return
    }

    try {
      setLoading(true)
      const res = await api.post('/auth/login', {
        username: username.trim(),
        password,
      })

      if (res.data.success) {
        login(res.data.data.user, null, res.data.data.csrfToken)
        toast.success('Welcome back!')
        const bp = getBasePath()
        window.location.href = `${bp}/dashboard`
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed. Please check credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#1a1d27] border border-[#2d3148] rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/25">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">VPN Panel</h2>
          <p className="text-xs text-slate-400">Unified Management for sing-box & Xray</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Username</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                required
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#14161f] border border-[#2d3148] rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-slate-500 hover:text-slate-300 absolute right-3 top-3"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/20"
          >
            {loading && <Spinner size="sm" />}
            <span>Sign In</span>
          </button>
        </form>

        <div className="text-center">
          <p className="text-[11px] text-slate-500">
            Default: <code className="text-indigo-400">admin</code> / <code className="text-indigo-400">admin123</code>
          </p>
        </div>
      </div>
    </div>
  )
}
