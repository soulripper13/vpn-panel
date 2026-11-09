import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { getBasePath } from './utils/api'
import Layout from './components/layout/Layout'

const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inbounds = lazy(() => import('./pages/Inbounds'))
const Clients = lazy(() => import('./pages/Clients'))
const Settings = lazy(() => import('./pages/Settings'))
const Logs = lazy(() => import('./pages/Logs'))

function PageLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-slate-400" role="status">
      Loading page…
    </div>
  )
}

function AuthGuard({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function GuestGuard({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  const basename = getBasePath()

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestGuard>
              <Suspense fallback={<PageLoading />}><Login /></Suspense>
            </GuestGuard>
          }
        />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Suspense fallback={<PageLoading />}><Dashboard /></Suspense>} />
          <Route path="inbounds" element={<Suspense fallback={<PageLoading />}><Inbounds /></Suspense>} />
          <Route path="clients" element={<Suspense fallback={<PageLoading />}><Clients /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageLoading />}><Settings /></Suspense>} />
          <Route path="logs" element={<Suspense fallback={<PageLoading />}><Logs /></Suspense>} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
