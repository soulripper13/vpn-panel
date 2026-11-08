import { useEffect, useRef, useState } from 'react'
import { getBasePath } from '../utils/api'

export function useWebSocket() {
  const [data, setData] = useState(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const reconnectTimeout = useRef(null)

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const bp = getBasePath()
      const wsUrl = `${protocol}//${window.location.host}${bp}/ws`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data)
          if (parsed.data) {
            setData(parsed.data)
          }
        } catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        reconnectTimeout.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      if (wsRef.current) wsRef.current.close()
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
    }
  }, [])

  return { data, connected }
}
