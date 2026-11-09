import React from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  ArrowUpRight,
  ArrowDownRight,
  Radio,
  Users,
  Cpu,
  HardDrive,
  Activity,
  Server,
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import EngineCard from '../components/ui/EngineCard'
import { useStats } from '../hooks/useStats'
import { useEngine } from '../hooks/useEngine'
import { formatBytes } from '../utils/format'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

export default function Dashboard() {
  const { overview: polledOverview, chartData } = useStats()
  const { wsData } = useOutletContext()
  const { performAction } = useEngine()

  // Prefer live WebSocket data, fallback to REST polled overview
  const overview = wsData || polledOverview

  const system = overview?.system || {}
  const engines = overview?.engines || {}
  const totals = overview?.totals || {}

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Overview Dashboard</h2>
        <p className="text-xs text-slate-400">Real-time status of proxy engines and server resources</p>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Upload"
          value={formatBytes(totals.totalUp || 0)}
          icon={ArrowUpRight}
          color="purple"
          subtext="Total outgoing traffic"
        />
        <StatCard
          title="Total Download"
          value={formatBytes(totals.totalDown || 0)}
          icon={ArrowDownRight}
          color="blue"
          subtext="Total incoming traffic"
        />
        <StatCard
          title="Active Inbounds"
          value={`${totals.activeInbounds || 0} / ${totals.inboundCount || 0}`}
          icon={Radio}
          color="indigo"
          subtext="Across sing-box & xray"
        />
        <StatCard
          title="Total Clients"
          value={`${totals.activeClients || 0} / ${totals.clientCount || 0}`}
          icon={Users}
          color="emerald"
          subtext="Configured proxy users"
        />
      </div>

      {/* Engine Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EngineCard
          name="singbox"
          title="sing-box Engine"
          status={engines.singbox}
          onAction={performAction}
        />
        <EngineCard
          name="xray"
          title="Xray Engine"
          status={engines.xray}
          onAction={performAction}
        />
      </div>

      {/* System Resources & Live Traffic Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System gauges */}
        <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-[#2d3148] pb-3">
            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4 text-indigo-400" />
              <h3 className="font-semibold text-sm text-white">System Resources</h3>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">{system.uptime || 'Online'}</span>
          </div>

          {/* CPU */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 flex items-center space-x-1.5">
                <Cpu className="w-3.5 h-3.5" />
                <span>CPU Usage ({system.cpuCores || 2} Cores)</span>
              </span>
              <span className="font-mono text-slate-200">{system.cpuUsage || 0}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, system.cpuUsage || 0)}%` }}
              />
            </div>
          </div>

          {/* RAM */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>Memory</span>
              </span>
              <span className="font-mono text-slate-200">
                {formatBytes(system.memUsed || 0)} / {formatBytes(system.memTotal || 1)} ({system.memPercent || 0}%)
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-purple-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, system.memPercent || 0)}%` }}
              />
            </div>
          </div>

          {/* Disk */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 flex items-center space-x-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                <span>Disk</span>
              </span>
              <span className="font-mono text-slate-200">
                {formatBytes(system.diskUsed || 0)} / {formatBytes(system.diskTotal || 1)} ({system.diskPercent || 0}%)
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, system.diskPercent || 0)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Traffic Chart */}
        <div className="lg:col-span-2 bg-[#1a1d27] border border-[#2d3148] rounded-xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between border-b border-[#2d3148] pb-3">
            <h3 className="font-semibold text-sm text-white">24h Traffic Overview</h3>
            <div className="flex items-center space-x-4 text-xs">
              <span className="flex items-center space-x-1.5 text-purple-400">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
                <span>Upload</span>
              </span>
              <span className="flex items-center space-x-1.5 text-blue-400">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                <span>Download</span>
              </span>
            </div>
          </div>

          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorUp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" opacity={0.5} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  tickFormatter={(val) => formatBytes(val, 0)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#14161f',
                    borderColor: '#2d3148',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#fff',
                  }}
                  formatter={(value) => [formatBytes(value), '']}
                />
                <Area type="monotone" dataKey="upload" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorUp)" />
                <Area type="monotone" dataKey="download" stroke="#3b82f6" fillOpacity={1} fill="url(#colorDown)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
