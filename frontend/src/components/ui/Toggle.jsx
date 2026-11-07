import React from 'react'
import clsx from 'clsx'

export default function Toggle({ checked = false, onChange, disabled = false, size = 'md' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      className={clsx(
        'relative inline-flex flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none',
        checked ? 'bg-indigo-600' : 'bg-slate-700',
        disabled && 'opacity-50 cursor-not-allowed',
        size === 'sm' ? 'h-4 w-8' : 'h-6 w-11'
      )}
    >
      <span
        className={clsx(
          'pointer-events-none inline-block transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out',
          size === 'sm'
            ? checked ? 'translate-x-4 h-3 w-3 mt-0.5 ml-0.5' : 'translate-x-0.5 h-3 w-3 mt-0.5'
            : checked ? 'translate-x-5 h-5 w-5 mt-0.5 ml-0.5' : 'translate-x-0.5 h-5 w-5 mt-0.5'
        )}
      />
    </button>
  )
}
