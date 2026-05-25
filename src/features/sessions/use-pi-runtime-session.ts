import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Session, SessionEvent } from '@/lib/api'
import {
  initialPiRuntimeState,
  type PiRpcCommand,
  type PiRpcCommandType,
  piRuntimeReducer,
  runtimeWebSocketUrl,
} from './pi-runtime'

export function usePiRuntimeSession({
  session,
  events,
  onEventsChanged,
}: {
  session: Session | null
  events: SessionEvent[]
  onEventsChanged: () => void
}) {
  const [state, dispatch] = useReducer(piRuntimeReducer, initialPiRuntimeState)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const endpoint = useMemo(() => (session ? runtimeWebSocketUrl(session.runtimeEndpointPath) : null), [session])

  useEffect(() => {
    if (sessionIdRef.current !== (session?.id ?? null)) {
      sessionIdRef.current = session?.id ?? null
      dispatch({ type: 'reset' })
    }
    dispatch({
      type: 'persisted_events',
      events: session ? events.filter((event) => event.sessionId === session.id) : [],
    })
  }, [events, session])

  useEffect(() => {
    void connectionAttempt
    if (!endpoint) {
      dispatch({ type: 'connection', state: 'closed' })
      return
    }
    window.clearTimeout(reconnectTimerRef.current ?? undefined)
    const socket = new WebSocket(endpoint)
    socketRef.current = socket
    dispatch({ type: 'connection', state: 'connecting' })

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return
      dispatch({ type: 'connection', state: 'open' })
    })
    socket.addEventListener('message', (message) => {
      if (socketRef.current !== socket) return
      const payload = parseRuntimeMessage(message.data)
      if (payload instanceof Error) {
        dispatch({ type: 'connection', state: 'error', error: payload.message })
        return
      }
      dispatch({ type: 'event', event: payload, at: new Date().toISOString() })
      if (payload.type === 'agent_end' || payload.type === 'tool_execution_end' || payload.type === 'bridge_exit') {
        window.clearTimeout(refreshTimerRef.current ?? undefined)
        refreshTimerRef.current = window.setTimeout(onEventsChanged, 150)
      }
    })
    socket.addEventListener('error', () => {
      if (socketRef.current !== socket) return
      dispatch({ type: 'connection', state: 'error', error: 'Runtime WebSocket failed' })
    })
    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return
      socketRef.current = null
      dispatch({ type: 'connection', state: 'closed' })
      reconnectTimerRef.current = window.setTimeout(() => {
        setConnectionAttempt((attempt) => attempt + 1)
      }, 750)
    })

    return () => {
      window.clearTimeout(refreshTimerRef.current ?? undefined)
      window.clearTimeout(reconnectTimerRef.current ?? undefined)
      if (socketRef.current === socket) {
        socketRef.current = null
      }
      socket.close()
    }
  }, [endpoint, onEventsChanged, connectionAttempt])

  const sendCommand = useCallback((type: PiRpcCommandType, message?: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      dispatch({ type: 'connection', state: 'error', error: 'Runtime WebSocket is not open' })
      return false
    }
    const nextCommand = command(type, message)
    dispatch({ type: 'command_sent', command: nextCommand, at: new Date().toISOString() })
    socket.send(JSON.stringify(nextCommand))
    return true
  }, [])

  return {
    endpoint,
    state,
    sendPrompt: (message: string) => sendCommand('prompt', message),
    sendFollowUp: (message: string) => sendCommand('follow_up', message),
    sendSteer: (message: string) => sendCommand('steer', message),
    abort: () => sendCommand('abort'),
  }
}

function command(type: PiRpcCommandType, message?: string): PiRpcCommand {
  return {
    id: crypto.randomUUID(),
    type,
    ...(message ? { message } : {}),
  }
}

function parseRuntimeMessage(data: unknown): Record<string, unknown> | Error {
  if (typeof data !== 'string') {
    return { type: 'message', data: String(data) }
  }
  try {
    const parsed = JSON.parse(data) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Error('Runtime WebSocket emitted a non-object JSON message')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    return error instanceof Error ? error : new Error('Runtime WebSocket emitted invalid JSON')
  }
}
