import axios from 'axios'
import { useAuthStore } from '../store/authStore'

export const getBasePath = () => {
  if (typeof window === 'undefined') return ''
  const bp = window.__BASE_PATH__ || ''
  if (!bp || bp === '/') return ''
  return bp.replace(/\/$/, '')
}

const api = axios.create({
  baseURL: `${getBasePath()}/api`,
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
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
