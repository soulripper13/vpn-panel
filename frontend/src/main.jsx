import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a1d27',
            color: '#e2e8f0',
            border: '1px solid #2d3148',
            borderRadius: '10px',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#1a1d27' } },
          error: { iconTheme: { primary: '#f43f5e', secondary: '#1a1d27' } },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
)
