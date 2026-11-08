import React, { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Save, Key, Shield, HardDrive } from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'
import Spinner from '../components/ui/Spinner'

export default function Settings() {
  const [settings, setSettings] = useState({
    server_ip: typeof window !== 'undefined' ? (window.location.hostname || '') : '',
    panel_port: '2096',
    cert_fullchain: '',
    cert_privkey: '',
    singbox_bin: '/usr/bin/sing-box',
    xray_bin: '/usr/local/x-ui/bin/xray-linux-amd64',
  })

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get('/settings')
        if (res.data.data) {
          setSettings((prev) => ({
            ...prev,
            ...res.data.data,
            server_ip: res.data.data.server_ip || prev.server_ip,
          }))
        }
      } catch {}
    }
    load()
  }, [])

  const handleSaveSettings = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      const res = await api.put('/settings', settings)
      if (res.data.success) {
        toast.success('Settings saved successfully!')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save settings')
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }

    try {
      setPwLoading(true)
      const res = await api.put('/auth/change-password', {
        currentPassword,
        newPassword,
      })

      if (res.data.success) {
        toast.success('Password changed successfully!')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update password')
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Panel Settings</h2>
        <p className="text-xs text-slate-400">Configure core engine paths, certificates, and panel access</p>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSaveSettings} className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 shadow-lg space-y-5">
        <div className="flex items-center space-x-2.5 pb-3 border-b border-[#2d3148]">
          <SettingsIcon className="w-5 h-5 text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">General & Network Settings</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Server Public IP / Hostname</label>
            <input
              type="text"
              value={settings.server_ip}
              onChange={(e) => setSettings({ ...settings, server_ip: e.target.value })}
              className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">Used for share links and QR codes</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Web Panel Port</label>
            <input
              type="number"
              value={settings.panel_port}
              onChange={(e) => setSettings({ ...settings, panel_port: e.target.value })}
              className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-[#2d3148]/60">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">TLS Certificate Paths</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Fullchain Certificate (.pem / .crt)</label>
              <input
                type="text"
                value={settings.cert_fullchain}
                onChange={(e) => setSettings({ ...settings, cert_fullchain: e.target.value })}
                className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Private Key (.key / .pem)</label>
              <input
                type="text"
                value={settings.cert_privkey}
                onChange={(e) => setSettings({ ...settings, cert_privkey: e.target.value })}
                className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-[#2d3148]/60">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Core Binary Paths</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">sing-box Binary</label>
              <input
                type="text"
                value={settings.singbox_bin}
                onChange={(e) => setSettings({ ...settings, singbox_bin: e.target.value })}
                className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Xray Binary</label>
              <input
                type="text"
                value={settings.xray_bin}
                onChange={(e) => setSettings({ ...settings, xray_bin: e.target.value })}
                className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3">
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
          >
            {loading ? <Spinner size="xs" /> : <Save className="w-4 h-4" />}
            <span>Save Settings</span>
          </button>
        </div>
      </form>

      {/* Change Password Form */}
      <form onSubmit={handleChangePassword} className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 shadow-lg space-y-4">
        <div className="flex items-center space-x-2.5 pb-3 border-b border-[#2d3148]">
          <Key className="w-5 h-5 text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">Change Admin Password</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">New Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Confirm New Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={pwLoading}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition flex items-center space-x-1.5"
          >
            {pwLoading && <Spinner size="xs" />}
            <span>Update Password</span>
          </button>
        </div>
      </form>
    </div>
  )
}
