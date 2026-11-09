import { useEffect, useState } from 'react'
import { getBasePath } from '../utils/api'

export function useWebSocket() {
  const [data, setData] = useState(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let active = true
    let ws = null
    let reconnectTimeout = null

    function connect() {
      if (!active) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const bp = getBasePath()
      const wsUrl = `${protocol}//${window.location.host}${bp}/ws`

      try {
        ws = new WebSocket(wsUrl)
      } catch {
        reconnectTimeout = setTimeout(connect, 3000)
        return
      }

      ws.onopen = () => {
        if (active) setConnected(true)
      }

      ws.onmessage = (event) => {
        if (!active) return
        try {
          const parsed = JSON.parse(event.data)
          if (parsed.data) {
            setData(parsed.data)
          }
        } catch {}
      }

      ws.onclose = () => {
        if (!active) return
        setConnected(false)
        reconnectTimeout = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      active = false
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (ws) {
        ws.onclose = null
        ws.close()
      }
      setConnected(false)
    }
  }, [])

  return { data, connected }
}
