import React from 'react'
import clsx from 'clsx'

export default function Badge({ children, variant = 'default', size = 'sm', className = '' }) {
  const variants = {
    default: 'bg-slate-800 text-slate-300 border-slate-700',
    singbox: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
    xray: 'bg-blue-950/80 text-blue-300 border-blue-800/60',
    success: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
    danger: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
    warning: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    indigo: 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60',
  }

  const sizes = {
    xs: 'px-1.5 py-0.5 text-xs',
    sm: 'px-2 py-0.5 text-xs font-medium',
    md: 'px-2.5 py-1 text-sm font-medium',
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md border tracking-wide uppercase',
        variants[variant] || variants.default,
        sizes[size] || sizes.sm,
        className
      )}
    >
      {children}
    </span>
  )
}
