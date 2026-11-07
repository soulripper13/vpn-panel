import React from 'react'
import clsx from 'clsx'

export default function Spinner({ size = 'md', className = '' }) {
  const sizes = {
    xs: 'w-3.5 h-3.5 border-2',
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
  }

  return (
    <div
      className={clsx(
        'animate-spin rounded-full border-slate-600 border-t-indigo-500',
        sizes[size] || sizes.md,
        className
      )}
    />
  )
}
