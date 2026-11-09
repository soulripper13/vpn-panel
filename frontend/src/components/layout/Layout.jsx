import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { Toaster } from 'react-hot-toast'
import { useWebSocket } from '../../hooks/useWebSocket'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { data: wsData, connected: wsConnected } = useWebSocket()

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-100 flex flex-col font-sans">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a1d27',
            color: '#f8fafc',
            border: '1px solid #2d3148',
          },
        }}
      />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-64 flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setSidebarOpen(true)} wsConnected={wsConnected} />
        <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet context={{ wsData, wsConnected }} />
        </main>
      </div>
    </div>
  )
}
