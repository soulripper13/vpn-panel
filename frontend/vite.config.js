import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let appVersion = '1.0.0'
try {
  const rootVersionFile = path.resolve(__dirname, '../VERSION')
  if (fs.existsSync(rootVersionFile)) {
    appVersion = fs.readFileSync(rootVersionFile, 'utf8').trim().split('\n')[0].trim()
  } else {
    const verData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../backend/version.json'), 'utf8'))
    appVersion = verData.version || appVersion
  }
} catch {}

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:2096',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.setHeader('x-forwarded-host', req.headers.host)
            proxyReq.setHeader('x-forwarded-proto', 'http')
          })
        },
      },
      '/ws': {
        target: 'ws://localhost:2096',
        ws: true,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq, req) => {
            proxyReq.setHeader('x-forwarded-host', req.headers.host)
            proxyReq.setHeader('x-forwarded-proto', 'http')
          })
        },
      },
    },
  },
})
