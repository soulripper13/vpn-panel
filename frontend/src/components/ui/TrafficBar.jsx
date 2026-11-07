import React from 'react'
import clsx from 'clsx'
import { formatBytes } from '../../utils/format'

export default function TrafficBar({ used = 0, limit = 0, className = '' }) {
  if (!limit || limit <= 0) {
    return (
      <div className={clsx('text-xs text-slate-400 font-mono', className)}>
        {formatBytes(used)} / <span className="text-slate-500">∞</span>
      </div>
    )
  }

  const percent = Math.min(100, Math.round((used / limit) * 100))
  const isHigh = percent >= 85
  const isMed = percent >= 60

  return (
    <div className={clsx('space-y-1', className)}>
      <div className="flex justify-between text-xs text-slate-300 font-mono">
        <span>{formatBytes(used)}</span>
        <span className="text-slate-500">{formatBytes(limit)} ({percent}%)</span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
        <div
          className={clsx(
            'h-full transition-all duration-300 rounded-full',
            isHigh ? 'bg-rose-500' : isMed ? 'bg-amber-500' : 'bg-indigo-500'
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
