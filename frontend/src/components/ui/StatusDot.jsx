import React from 'react'
import clsx from 'clsx'

export default function StatusDot({ active = false, size = 'md', className = '' }) {
  const sizes = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3',
  }

  return (
    <span className={clsx('relative inline-flex flex-shrink-0', sizes[size], className)}>
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={clsx(
          'relative inline-flex rounded-full h-full w-full',
          active ? 'bg-emerald-500' : 'bg-rose-500'
        )}
      />
    </span>
  )
}
