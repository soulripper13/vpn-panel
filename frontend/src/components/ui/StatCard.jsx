import React from 'react'
import clsx from 'clsx'

export default function StatCard({ title, value, subtext, icon: Icon, color = 'indigo', className = '' }) {
  const iconColors = {
    indigo: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  }

  return (
    <div className={clsx('bg-[#1a1d27] border border-[#2d3148] rounded-xl p-5 shadow-lg flex items-start justify-between', className)}>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
        <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
        {subtext && <p className="text-xs text-slate-400">{subtext}</p>}
      </div>
      {Icon && (
        <div className={clsx('p-3 rounded-lg border flex items-center justify-center', iconColors[color] || iconColors.indigo)}>
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  )
}
