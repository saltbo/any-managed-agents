import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Session, SessionEvent } from '@/lib/amarpc'
import {
  initialSessionRuntimeState,
  type SessionSocketCommand,
  type SessionSocketCommandType,
  sessionSocketUrl,
  sessionRuntimeReducer,
} from './session-runtime'

export function useSessionRuntimeSession({
  session,
  events,
  onEventsChanged,
}: {
  session: Session | null
  events: SessionEvent[]
  onEventsChanged: () => void
}) {
  const [state, dispatch] = useReducer(sessionRuntimeReducer, initialSessionRuntimeState)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const live = session !== null && (session.status.phase === 'idle' || session.status.phase === 'running')
  const sessionId = session?.metadata.uid ?? ''
  // Persisted events stay inspectable for any session; the live socket only
  // connects while the runtime is actually active.
  const endpoint = useMemo(
    () => (live && sessionId ? sessionSocketUrl(`/api/v1/sessions/${sessionId}/socket`) : null),
    [live, sessionId],
  )

  useEffect(() => {
    if (sessionIdRef.current !== (session?.metadata.uid ?? null)) {
      sessionIdRef.current = session?.metadata.uid ?? null
      dispatch({ type: 'reset' })
    }
    dispatch({
      type: 'persisted_events',
      events: session ? events.filter((event) => event.sessionId === session.metadata.uid) : [],
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
      /* v8 ignore start -- guard fires only in stale-socket race conditions */
      if (socketRef.current !== socket) return
      /* v8 ignore stop */
      dispatch({ type: 'connection', state: 'open' })
    })
    socket.addEventListener('message', (message) => {
      /* v8 ignore start -- guard fires only in stale-socket race conditions */
      if (socketRef.current !== socket) return
      /* v8 ignore stop */
      const frame = parseRuntimeMessage(message.data)
      if (frame instanceof Error) {
        dispatch({ type: 'connection', state: 'error', error: frame.message })
        return
      }
      if (frame.type === 'backfill') {
        dispatch({ type: 'persisted_events', events: frame.events })
      } else {
        dispatch({ type: 'persisted_events', events: [frame.event] })
      }
      if (shouldRefreshAfterFrame(frame)) {
        window.clearTimeout(refreshTimerRef.current ?? undefined)
        refreshTimerRef.current = window.setTimeout(onEventsChanged, 150)
      }
    })
    socket.addEventListener('error', () => {
      if (socketRef.current !== socket) return
      dispatch({ type: 'connection', state: 'error', error: 'Session socket failed' })
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

  const sendCommand = useCallback((type: SessionSocketCommandType, content?: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      dispatch({ type: 'connection', state: 'error', error: 'Session socket is not open' })
      return false
    }
    const nextCommand = command(type, content)
    dispatch({ type: 'command_sent', command: nextCommand, at: new Date().toISOString() })
    socket.send(JSON.stringify(nextCommand))
    return true
  }, [])

  return {
    endpoint,
    state,
    sendPrompt: (message: string) => sendCommand('prompt', message),
    sendSteer: (message: string) => sendCommand('steer', message),
    abort: () => sendCommand('abort'),
  }
}

function command(type: SessionSocketCommandType, content?: string): SessionSocketCommand {
  return {
    id: crypto.randomUUID(),
    type,
    ...(content ? { content } : {}),
  }
}

type RuntimeSocketFrame =
  | { type: 'backfill'; events: SessionEvent[] }
  | { type: 'event'; event: SessionEvent }

function parseRuntimeMessage(data: unknown): RuntimeSocketFrame | Error {
  if (typeof data !== 'string') {
    return new Error('Session socket emitted non-text data')
  }
  try {
    const parsed = JSON.parse(data) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Error('Session socket emitted a non-object JSON message')
    }
    return socketFrameFrom(parsed as Record<string, unknown>)
  } catch (error) {
    /* v8 ignore start -- JSON.parse always throws SyntaxError (an Error); the non-Error branch is unreachable */
    return error instanceof Error ? error : new Error('Session socket emitted invalid JSON')
    /* v8 ignore stop */
  }
}

function socketFrameFrom(parsed: Record<string, unknown>): RuntimeSocketFrame | Error {
  if (parsed.type === 'backfill') {
    return Array.isArray(parsed.events)
      ? { type: 'backfill', events: parsed.events.filter(isSessionEvent) }
      : new Error('Session socket emitted invalid backfill frame')
  }
  if (parsed.type === 'event') {
    return isSessionEvent(parsed.event)
      ? { type: 'event', event: parsed.event }
      : new Error('Session socket emitted invalid event frame')
  }
  return new Error('Session socket emitted an unsupported frame')
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const event = value as Partial<SessionEvent>
  return (
    typeof event.id === 'string' &&
    typeof event.sessionId === 'string' &&
    typeof event.sequence === 'number' &&
    typeof event.type === 'string' &&
    typeof event.createdAt === 'string' &&
    Boolean(event.payload) &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload)
  )
}

function shouldRefreshAfterFrame(frame: RuntimeSocketFrame) {
  if (frame.type === 'backfill') {
    return false
  }
  const eventType = frame.event.type
  return (
    eventType === 'agent_end' ||
    eventType === 'turn_end' ||
    eventType === 'tool_execution_end' ||
    eventType === 'runtime.error'
  )
}
