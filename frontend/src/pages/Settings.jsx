import React, { useState, useEffect } from 'react'
import {
  Settings as SettingsIcon,
  Save,
  Key,
  Shield,
  HardDrive,
  Download,
  ArrowUpCircle,
  RefreshCw,
  ExternalLink,
  Cpu,
  CheckCircle2,
  GitCommit,
  Layers,
} from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'
import Spinner from '../components/ui/Spinner'
import Badge from '../components/ui/Badge'
import PanelUpdateModal from '../components/modals/PanelUpdateModal'

export default function Settings() {
  const [settings, setSettings] = useState({
    server_ip: typeof window !== 'undefined' ? (window.location.hostname || '') : '',
    panel_port: '2096',
    web_base_path: '/',
    cert_fullchain: '',
    cert_privkey: '',
    singbox_bin: '/usr/bin/sing-box',
    xray_bin: '/usr/local/x-ui/bin/xray-linux-amd64',
  })

  // Binary & Panel updates state
  const [updates, setUpdates] = useState(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updatingEngine, setUpdatingEngine] = useState(null)
  const [showPanelUpdateModal, setShowPanelUpdateModal] = useState(false)

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  const checkUpdates = async () => {
    try {
      setCheckingUpdates(true)
      const res = await api.get('/engine/updates')
      if (res.data?.data) {
        setUpdates(res.data.data)
      }
    } catch {
      // silently ignore or notify on manual check
    } finally {
      setCheckingUpdates(false)
    }
  }

  const handleUpdateBinary = async (engine) => {
    const title = engine === 'singbox' ? 'sing-box' : 'Xray-core'
    if (!confirm(`Update ${title} binary in-place to the latest GitHub release? The service will be automatically restarted.`)) {
      return
    }

    try {
      setUpdatingEngine(engine)
      const res = await api.post(`/engine/${engine}/update`)
      if (res.data.success) {
        toast.success(res.data.message || `${title} binary updated successfully!`)
        await checkUpdates()
      }
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to update ${title}`)
    } finally {
      setUpdatingEngine(null)
    }
  }

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
      checkUpdates()
    }
    load()
  }, [])

  const generateRandomPath = () => {
    const rand = Math.random().toString(36).substring(2, 10)
    setSettings((prev) => ({ ...prev, web_base_path: `/${rand}` }))
  }

  const handleSaveSettings = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      const prevBase = (typeof window !== 'undefined' && window.__BASE_PATH__ && window.__BASE_PATH__ !== '/')
        ? window.__BASE_PATH__.replace(/\/$/, '')
        : ''

      let targetBase = (settings.web_base_path || '').trim()
      if (targetBase === '/' || targetBase === '') {
        targetBase = ''
      } else if (!targetBase.startsWith('/')) {
        targetBase = '/' + targetBase
      }
      targetBase = targetBase.replace(/\/$/, '')

      const res = await api.put('/settings', settings)
      if (res.data.success) {
        if (targetBase !== prevBase) {
          toast.success(`Web secret path updated to "${targetBase || '/'}"! Redirecting...`, { duration: 3000 })
          setTimeout(() => {
            window.location.href = `${targetBase || ''}/settings`
          }, 1500)
          return
        }
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            <p className="text-[11px] text-slate-500 mt-1">Listening web dashboard port</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-300 block">Web Secret Base Path</label>
              <button
                type="button"
                onClick={generateRandomPath}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium transition cursor-pointer"
              >
                + Random Token
              </button>
            </div>
            <input
              type="text"
              placeholder="/ (e.g. /my-secret)"
              value={settings.web_base_path || '/'}
              onChange={(e) => setSettings({ ...settings, web_base_path: e.target.value })}
              className="w-full bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Hides panel behind secret URL. Scanners hitting / get 404.
            </p>
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

      {/* Panel & Core Engine In-Panel Updates */}
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 shadow-lg space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#2d3148]">
          <div className="flex items-center space-x-2.5">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">Panel & Core Engine Updates</h3>
              <p className="text-xs text-slate-400">Update the VPN Panel system, sing-box, and Xray binaries directly from official GitHub releases</p>
            </div>
          </div>
          <button
            type="button"
            onClick={checkUpdates}
            disabled={checkingUpdates}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition flex items-center space-x-1.5 w-fit"
          >
            {checkingUpdates ? <Spinner size="xs" /> : <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />}
            <span>Check for Updates</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* VPN Panel update card */}
          <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white text-sm">VPN Panel</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    System
                  </span>
                </div>
                {updates?.panel?.hasUpdate ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
                    Update Available
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Up to date</span>
                  </span>
                )}
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current:</span>
                  <span className="text-slate-200">
                    v{updates?.panel?.currentVersion || '1.2.0'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Latest Release:</span>
                  <span className="text-indigo-300 font-semibold">
                    v{updates?.panel?.latestVersion || '1.2.0'}
                  </span>
                </div>
                {(updates?.panel?.releaseName || updates?.panel?.releaseNotes) && (
                  <div className="pt-1 text-[11px] text-slate-400 font-sans line-clamp-1 italic" title={updates.panel.releaseNotes}>
                    "{updates.panel.releaseName || updates.panel.releaseNotes}"
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-[#2d3148]">
              <a
                href={updates?.panel?.releaseUrl || 'https://github.com/soulripper13/vpn-panel/releases'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-slate-400 hover:text-indigo-300 transition flex items-center space-x-1"
              >
                <span>Releases</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              <button
                type="button"
                onClick={() => setShowPanelUpdateModal(true)}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
              >
                <ArrowUpCircle className="w-3.5 h-3.5" />
                <span>{updates?.panel?.hasUpdate ? `Update to v${updates.panel.latestVersion}` : 'Update Panel'}</span>
              </button>
            </div>
          </div>

          {/* sing-box update card */}
          <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white text-sm">sing-box</span>
                  <Badge variant="singbox" size="xs">SagerNet</Badge>
                </div>
                {updates?.singbox?.hasUpdate ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Update Available
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Up to date</span>
                  </span>
                )}
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current:</span>
                  <span className="text-slate-200">{updates?.singbox?.currentVersion ? `v${updates.singbox.currentVersion}` : 'Checking...'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Latest:</span>
                  <span className="text-indigo-300 font-semibold">{updates?.singbox?.latestVersion ? `v${updates.singbox.latestVersion}` : 'Checking...'}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-[#2d3148]">
              <a
                href={updates?.singbox?.releaseUrl || 'https://github.com/SagerNet/sing-box/releases'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-slate-400 hover:text-indigo-300 transition flex items-center space-x-1"
              >
                <span>Release Notes</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              <button
                type="button"
                onClick={() => handleUpdateBinary('singbox')}
                disabled={updatingEngine === 'singbox'}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
              >
                {updatingEngine === 'singbox' ? <Spinner size="xs" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                <span>{updatingEngine === 'singbox' ? 'Updating...' : 'Update sing-box'}</span>
              </button>
            </div>
          </div>

          {/* Xray-core update card */}
          <div className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white text-sm">Xray-core</span>
                  <Badge variant="xray" size="xs">XTLS</Badge>
                </div>
                {updates?.xray?.hasUpdate ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Update Available
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Up to date</span>
                  </span>
                )}
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current:</span>
                  <span className="text-slate-200">{updates?.xray?.currentVersion ? `v${updates.xray.currentVersion}` : 'Checking...'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Latest:</span>
                  <span className="text-purple-300 font-semibold">{updates?.xray?.latestVersion ? `v${updates.xray.latestVersion}` : 'Checking...'}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-[#2d3148]">
              <a
                href={updates?.xray?.releaseUrl || 'https://github.com/XTLS/Xray-core/releases'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-slate-400 hover:text-indigo-300 transition flex items-center space-x-1"
              >
                <span>Release Notes</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              <button
                type="button"
                onClick={() => handleUpdateBinary('xray')}
                disabled={updatingEngine === 'xray'}
                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
              >
                {updatingEngine === 'xray' ? <Spinner size="xs" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                <span>{updatingEngine === 'xray' ? 'Updating...' : 'Update Xray-core'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

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

      {/* Panel Self-Update Progress Modal */}
      {showPanelUpdateModal && (
        <PanelUpdateModal
          isOpen={showPanelUpdateModal}
          onClose={() => setShowPanelUpdateModal(false)}
          panelInfo={updates?.panel}
          onFinished={checkUpdates}
        />
      )}
    </div>
  )
}
