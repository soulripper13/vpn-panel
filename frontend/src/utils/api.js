import axios from 'axios'
import { useAuthStore } from '../store/authStore'

export const getBasePath = () => {
  if (typeof window === 'undefined') return ''
  if (window.__BASE_PATH__ && window.__BASE_PATH__ !== '/') {
    return window.__BASE_PATH__.replace(/\/$/, '')
  }
  // Fallback: detect base path from current pathname if first segment is not a known app route
  const segments = (window.location.pathname || '').split('/').filter(Boolean)
  if (segments.length > 0) {
    const first = segments[0]
    const knownRoutes = ['login', 'dashboard', 'inbounds', 'clients', 'settings', 'logs', 'sub', 'assets', 'api', 'ws']
    if (!knownRoutes.includes(first)) {
      const detected = `/${first}`
      window.__BASE_PATH__ = detected
      return detected
    }
  }
  return ''
}

const api = axios.create({
  baseURL: `${getBasePath()}/api`,
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// Dynamically ensure request baseURL matches active base path and attach token + CSRF header
api.interceptors.request.use((config) => {
  const bp = getBasePath()
  config.baseURL = `${bp}/api`
  const state = useAuthStore.getState()
  if (state.token) {
    config.headers.Authorization = `Bearer ${state.token}`
  }
  if (state.csrfToken) {
    config.headers['X-CSRF-Token'] = state.csrfToken
  }
  return config
})

// Auto-capture CSRF tokens and auto-logout on 401
api.interceptors.response.use(
  (res) => {
    const csrfHeader = res.headers?.['x-csrf-token']
    if (csrfHeader) {
      useAuthStore.getState().setCsrfToken(csrfHeader)
    } else if (res.data?.data?.csrfToken) {
      useAuthStore.getState().setCsrfToken(res.data.data.csrfToken)
    }
    return res
  },
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      const bp = getBasePath()
      window.location.href = `${bp}/login`
    }
    return Promise.reject(err)
  }
)

export default api
