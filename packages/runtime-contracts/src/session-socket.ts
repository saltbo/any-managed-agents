import type { EventRecord } from './session-events'

export type SessionSocketPromptMessage = {
  id: string
  type: 'prompt'
  content: string
}

export type SessionSocketAbortMessage = {
  id: string
  type: 'abort'
  reason?: string
}

export type SessionSocketSteerMessage = {
  id: string
  type: 'steer'
  content: string
}

export type SessionSocketBackfillRequestMessage = {
  id: string
  type: 'backfill'
  requestId?: string
  cursor?: number
  limit?: number
  eventType?: string
}

export type SessionSocketClientMessage =
  | SessionSocketPromptMessage
  | SessionSocketAbortMessage
  | SessionSocketSteerMessage
  | SessionSocketBackfillRequestMessage

export type SessionSocketEventMessage = {
  type: 'event'
  record: EventRecord
}

export type SessionSocketBackfillMessage = {
  type: 'backfill'
  requestId: string | null
  events: EventRecord[]
  nextCursor: number | null
  hasMore: boolean
}

export type SessionSocketAckMessage = {
  type: 'ack'
  id: string
}

export type SessionSocketErrorMessage = {
  type: 'error'
  id?: string
  message: string
}

export type SessionSocketRunnerUnavailableMessage = {
  type: 'runner_unavailable'
  message: string
}

export type SessionSocketServerMessage =
  | SessionSocketEventMessage
  | SessionSocketBackfillMessage
  | SessionSocketAckMessage
  | SessionSocketErrorMessage
  | SessionSocketRunnerUnavailableMessage

export function sessionSocketClientMessageFrom(value: unknown): SessionSocketClientMessage | null {
  const message = objectValue(value)
  if (typeof message.id !== 'string' || typeof message.type !== 'string') {
    return null
  }
  if (message.type === 'prompt' || message.type === 'steer') {
    return typeof message.content === 'string' ? { id: message.id, type: message.type, content: message.content } : null
  }
  if (message.type === 'abort') {
    return { id: message.id, type: 'abort', ...(typeof message.reason === 'string' ? { reason: message.reason } : {}) }
  }
  if (message.type === 'backfill') {
    return {
      id: message.id,
      type: 'backfill',
      requestId: typeof message.requestId === 'string' ? message.requestId : message.id,
      ...(typeof message.cursor === 'number' ? { cursor: message.cursor } : {}),
      ...(typeof message.limit === 'number' ? { limit: message.limit } : {}),
      ...(typeof message.eventType === 'string' ? { eventType: message.eventType } : {}),
    }
  }
  return null
}

export function sessionSocketServerMessageFrom(value: unknown): SessionSocketServerMessage | null {
  const message = objectValue(value)
  if (message.type === 'backfill') {
    return Array.isArray(message.events)
      ? {
          type: 'backfill',
          requestId: typeof message.requestId === 'string' ? message.requestId : null,
          events: message.events.filter(isEventRecord),
          nextCursor: typeof message.nextCursor === 'number' ? message.nextCursor : null,
          hasMore: message.hasMore === true,
        }
      : null
  }
  if (message.type === 'event') {
    return isEventRecord(message.record) ? { type: 'event', record: message.record } : null
  }
  if (message.type === 'ack') {
    return typeof message.id === 'string' ? { type: 'ack', id: message.id } : null
  }
  if (message.type === 'error') {
    return typeof message.message === 'string'
      ? { type: 'error', ...(typeof message.id === 'string' ? { id: message.id } : {}), message: message.message }
      : null
  }
  if (message.type === 'runner_unavailable') {
    return typeof message.message === 'string' ? { type: 'runner_unavailable', message: message.message } : null
  }
  return null
}

function isEventRecord(value: unknown): value is EventRecord {
  const record = objectValue(value)
  const event = objectValue(record.event)
  return (
    typeof record.id === 'string' &&
    typeof record.projectId === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.sequence === 'number' &&
    typeof record.createdAt === 'string' &&
    typeof event.type === 'string' &&
    isObject(event.payload)
  )
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
