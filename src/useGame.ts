import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMessage, RoomState, ServerMessage } from '../shared/protocol'

const sessionKey = 'cheongnok.session'
function savedSession(): { roomId: string; token: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey) || 'null')
    return value && typeof value.roomId === 'string' && typeof value.token === 'string' ? value : null
  } catch { return null }
}

export function useGame() {
  const socket = useRef<WebSocket | null>(null)
  const session = useRef(savedSession())
  const [state, setState] = useState<RoomState | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout>
    let attempts = 0
    const connect = () => {
      if (disposed) return
      setConnection('connecting')
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`)
      let restoring = false
      socket.current = ws
      ws.onopen = () => {
        if (disposed) { ws.close(); return }
        attempts = 0
        setConnection('online')
        if (session.current) {
          restoring = true
          ws.send(JSON.stringify({ type: 'resume', ...session.current }))
        }
      }
      ws.onmessage = event => {
        if (disposed) return
        let msg: ServerMessage
        try { msg = JSON.parse(event.data) } catch { return }
        setBusy(false)
        clearTimeout(busyTimer.current)
        if (msg.type === 'session') {
          restoring = false
          session.current = { roomId: msg.roomId, token: msg.token }
          try { sessionStorage.setItem(sessionKey, JSON.stringify(session.current)) } catch { /* Storage may be unavailable in private browsing. */ }
          setError('')
        } else if (msg.type === 'state') {
          setState(msg.state)
        } else if (msg.type === 'error') {
          if (restoring) {
            restoring = false
            session.current = null
            try { sessionStorage.removeItem(sessionKey) } catch { /* Storage is optional. */ }
            setState(null)
          }
          setError(msg.message)
        } else if (msg.type === 'left') {
          session.current = null
          try { sessionStorage.removeItem(sessionKey) } catch { /* Storage is optional. */ }
          setState(null)
        }
      }
      ws.onerror = () => ws.close()
      ws.onclose = event => {
        if (disposed) return
        setConnection('offline')
        setBusy(false)
        if (event.code === 4001 || event.code === 4002) {
          session.current = null
          try { sessionStorage.removeItem(sessionKey) } catch { /* Storage is optional. */ }
          setState(null)
          setError(event.code === 4001 ? '다른 탭에서 자리가 복구되었습니다. 이 탭은 로비로 돌아갑니다.' : '방이 만료되었습니다. 새 방을 만들어 주세요.')
        }
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000))
      }
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(retry)
      clearTimeout(busyTimer.current)
      socket.current?.close()
    }
  }, [])
  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError('서버에 다시 연결하는 중입니다. 잠시 기다려 주세요.')
      return
    }
    setError('')
    setBusy(true)
    clearTimeout(busyTimer.current)
    busyTimer.current = setTimeout(() => setBusy(false), 5000)
    socket.current.send(JSON.stringify(message))
  }, [])
  return { state, connection, error, setError, send, busy }
}
