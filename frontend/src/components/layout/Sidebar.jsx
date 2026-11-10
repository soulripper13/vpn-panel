import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Radio,
  Users,
  ScrollText,
  Settings,
  Shield,
  Layers,
} from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbounds', label: 'Inbounds', icon: Radio },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ isOpen, onClose }) {
  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 w-64 bg-[#14161f] border-r border-[#2d3148] flex flex-col transition-transform duration-200 lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand header */}
        <div className="h-16 px-6 flex items-center space-x-3 border-b border-[#2d3148]">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base text-white tracking-wide">VPN Panel</h1>
            <p className="text-[10px] text-indigo-400 font-medium tracking-wider uppercase">Sing-box & Xray</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  )
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Footer info */}
        <div className="p-3 border-t border-[#2d3148] m-3 bg-[#1a1d27]/60 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <Layers className="w-4 h-4 text-purple-400" />
            <div className="text-xs">
              <p className="text-slate-300 font-medium">Dual-Core Active</p>
              <p className="text-[10px] text-slate-500">sing-box + xray</p>
            </div>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
            v1.4.17
          </span>
        </div>
      </aside>
    </>
  )
}
