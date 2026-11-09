import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
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
