/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0f1117',
          card: '#1a1d27',
          elevated: '#1f2235',
          border: '#2d3148',
          hover: '#252840',
        },
        primary: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          light: '#818cf8',
          muted: 'rgba(99,102,241,0.15)',
        },
        accent: {
          DEFAULT: '#8b5cf6',
          hover: '#7c3aed',
          muted: 'rgba(139,92,246,0.15)',
        },
        success: {
          DEFAULT: '#10b981',
          muted: 'rgba(16,185,129,0.15)',
        },
        danger: {
          DEFAULT: '#f43f5e',
          hover: '#e11d48',
          muted: 'rgba(244,63,94,0.15)',
        },
        warning: {
          DEFAULT: '#f59e0b',
          muted: 'rgba(245,158,11,0.15)',
        },
        engine: {
          singbox: '#7c3aed',
          xray: '#2563eb',
          singboxMuted: 'rgba(124,58,237,0.15)',
          xrayMuted: 'rgba(37,99,235,0.15)',
        },
        text: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
          muted: '#64748b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'card': '0 4px 24px rgba(0,0,0,0.3)',
        'glow': '0 0 20px rgba(99,102,241,0.3)',
        'glow-success': '0 0 20px rgba(16,185,129,0.3)',
        'glow-danger': '0 0 20px rgba(244,63,94,0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
