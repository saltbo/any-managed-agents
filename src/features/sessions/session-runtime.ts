import type { SessionSocketClientMessage } from '@ama/runtime-contracts/session-socket'
import type { AmaSessionEventType } from '@shared/session-events'
import type { EventRecord } from '@/lib/amarpc'
import { getStoredAccessToken } from '@/lib/oidc'

export type SessionRuntimeConnectionState = 'connecting' | 'open' | 'closed' | 'error'
export type SessionRuntimeRunState = 'idle' | 'running' | 'error'
type AmaEvent = EventRecord['event']

export type SessionRuntimeCommand = Extract<SessionSocketClientMessage, { type: 'prompt' | 'steer' | 'abort' }>
export type SessionSocketClientMessageType = SessionRuntimeCommand['type']

export interface SessionRuntimeMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'streaming' | 'complete' | 'error'
  createdAt: string
}

export interface SessionRuntimeToolTrace {
  id: string
  callId: string
  name: string
  status: 'running' | 'success' | 'error'
  input: unknown
  output: unknown
  error: string | null
  durationMs: number | null
  createdAt: string
  updatedAt: string
  eventType: string
}

export interface SessionRuntimeDebugEvent {
  id: string
  type: AmaSessionEventType
  payload: Record<string, unknown>
  createdAt: string
}

export interface SessionRuntimeState {
  connection: SessionRuntimeConnectionState
  runState: SessionRuntimeRunState
  messages: SessionRuntimeMessage[]
  tools: SessionRuntimeToolTrace[]
  debugEvents: SessionRuntimeDebugEvent[]
  eventKeys: string[]
  error: string | null
}

export type SessionRuntimeAction =
  | { type: 'reset' }
  | { type: 'connection'; state: SessionRuntimeConnectionState; error?: string | null }
  | { type: 'command_sent'; command: SessionRuntimeCommand; at: string }
  | { type: 'event'; item: AmaEvent | EventRecord; at: string }
  | { type: 'persisted_events'; events: EventRecord[] }

export const initialSessionRuntimeState: SessionRuntimeState = {
  connection: 'connecting',
  runState: 'idle',
  messages: [],
  tools: [],
  debugEvents: [],
  eventKeys: [],
  error: null,
}

export function sessionRuntimeReducer(state: SessionRuntimeState, action: SessionRuntimeAction): SessionRuntimeState {
  if (action.type === 'reset') {
    return initialSessionRuntimeState
  }
  if (action.type === 'connection') {
    return {
      ...state,
      connection: action.state,
      error: action.error ?? (action.state === 'error' ? state.error : null),
    }
  }
  if (action.type === 'persisted_events') {
    return mergePersistedEvents(state, action.events)
  }
  if (action.type === 'event') {
    return mergePersistedEvents(state, [eventRecordFromAction(action.item, action.at, state)])
  }
  if (action.type === 'command_sent') {
    if (action.command.type === 'abort' || !action.command.content) {
      return state
    }
    return {
      ...state,
      runState: 'running',
      messages: upsertMessage(state.messages, {
        id: action.command.id,
        role: 'user',
        content: action.command.content,
        status: 'complete',
        createdAt: action.at,
      }),
    }
  }
  return state
}

export function sessionSocketUrl(socketPath: string) {
  const url = new URL(socketPath, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const accessToken = getStoredAccessToken()
  if (accessToken) {
    url.searchParams.set('access_token', accessToken)
  }
  return url.toString()
}

function eventRecordFromAction(event: AmaEvent | EventRecord, at: string, state: SessionRuntimeState): EventRecord {
  if (isEventRecord(event)) {
    return event
  }
  return {
    id: `${event.type}_${at}_${state.debugEvents.length + 1}`,
    projectId: '',
    sessionId: '',
    sequence: state.eventKeys.length + 1,
    event,
    createdAt: at,
  }
}

function isEventRecord(value: AmaEvent | EventRecord): value is EventRecord {
  return 'event' in value
}

function mergePersistedEvents(state: SessionRuntimeState, events: EventRecord[]) {
  const runtimeEvents = uniquePersistedRuntimeEvents(events).filter(({ stored, payload }) => {
    const key = runtimeEventKey(payload, sessionEventType(stored, payload))
    return !key || !state.eventKeys.includes(key)
  })
  const messages = dedupeRuntimeMessages(
    runtimeEvents
      .map(({ stored, payload }) => {
        const type = sessionEventType(stored, payload)
        if (type === 'message_start') {
          return messageFromStoredSessionEvent(stored, payload, 'streaming')
        }
        if (type === 'message_update') {
          const message = objectValue(payload.message)
          if (!stringField(message, 'id') && !scalarField(message, 'timestamp') && !scalarField(payload, 'timestamp')) {
            return null
          }
          return messageFromStoredSessionEvent(stored, payload, 'streaming')
        }
        if (type === 'message_end') {
          return messageFromStoredSessionEvent(stored, payload, 'complete')
        }
        if (type === 'runtime.error') {
          return messageFromRuntimeError(payload, stored.createdAt, stored.id)
        }
        return null
      })
      .filter((message): message is SessionRuntimeMessage => Boolean(message))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
  )
  const tools = runtimeEvents
    .filter(({ stored, payload }) => isToolEvent(sessionEventType(stored, payload)))
    .map(({ stored, payload }) => toolFromSessionEvent(payload, stored.createdAt, sessionEventType(stored, payload)))
    .filter((tool): tool is SessionRuntimeToolTrace => Boolean(tool))
    .reduce<SessionRuntimeToolTrace[]>((next, tool) => upsertTool(next, tool), [])
  const debugEvents = runtimeEvents.map(
    ({ stored, payload }): SessionRuntimeDebugEvent => ({
      id: stored.id,
      type: sessionEventType(stored, payload),
      payload,
      createdAt: stored.createdAt,
    }),
  )
  const eventKeys = runtimeEvents
    .map(({ stored, payload }) => runtimeEventKey(payload, sessionEventType(stored, payload)))
    .filter((key): key is string => Boolean(key))
  const hasTerminalEvent = runtimeEvents.some(({ stored, payload }) => {
    const type = sessionEventType(stored, payload)
    return type === 'agent_end' || type === 'turn_end'
  })
  const hasErrorEvent = runtimeEvents.some(({ stored }) => {
    return stored.event.type === 'runtime.error'
  })
  const latestError = [...runtimeEvents].reverse().find(({ stored }) => stored.event.type === 'runtime.error')
  return {
    ...state,
    runState: hasErrorEvent ? 'error' : hasTerminalEvent ? 'idle' : state.runState,
    error: latestError ? runtimeErrorMessage(latestError.payload) : state.error,
    messages: messages.reduce((next, message) => upsertMessage(next, message), state.messages),
    tools: state.tools.length === 0 ? tools : tools.reduce((next, tool) => upsertTool(next, tool), state.tools),
    debugEvents: [
      ...state.debugEvents.filter((item) => !debugEvents.some((event) => event.id === item.id)),
      ...debugEvents,
    ],
    eventKeys: mergeEventKeys(eventKeys, state.eventKeys),
  }
}

type StoredRuntimeEvent = {
  stored: EventRecord
  payload: Record<string, unknown>
}

function uniquePersistedRuntimeEvents(events: EventRecord[]): StoredRuntimeEvent[] {
  const seen = new Set<string>()
  let turnKey: string | null = null
  const uniqueEvents: StoredRuntimeEvent[] = []
  events
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((stored) => {
      const payload = objectValue(stored.event.payload)
      const type = sessionEventType(stored, payload)
      const nextTurnKey = runtimeTurnKey(payload, type)
      if (nextTurnKey) {
        turnKey = nextTurnKey
      }
      const key = runtimeEventKey(payload, type, isToolEvent(type) ? turnKey : null)
      if (key && seen.has(key)) {
        return
      }
      if (key) {
        seen.add(key)
      }
      uniqueEvents.push({ stored, payload })
    })
  return uniqueEvents
}

function sessionEventType(stored: EventRecord, _payload: Record<string, unknown>): AmaSessionEventType {
  return stored.event.type
}

function runtimeTurnKey(event: Record<string, unknown>, eventType: string) {
  if (!isTranscriptEvent(eventType)) {
    return null
  }
  const message = objectValue(event.message)
  const timestamp =
    scalarField(message, 'timestamp') ??
    scalarField(event, 'timestamp') ??
    stringField(event, 'responseId') ??
    stringField(message, 'id')
  if (!timestamp) {
    return null
  }
  return `${stringField(message, 'role') ?? ''}:${timestamp}`
}

function messageFromSessionEvent(event: Record<string, unknown>, at: string, status: SessionRuntimeMessage['status']) {
  const message = objectValue(event.message)
  const rawRole = stringField(message, 'role') ?? stringField(event, 'role') ?? 'assistant'
  if (rawRole === 'toolResult') {
    return null
  }
  const role: SessionRuntimeMessage['role'] =
    rawRole === 'user' || rawRole === 'assistant' || rawRole === 'system' ? rawRole : 'assistant'
  const errorMessage = stringField(message, 'errorMessage') ?? stringField(event, 'errorMessage')
  if (errorMessage) {
    return {
      id: stringField(event, 'id') ?? stringField(message, 'id') ?? `runtime_error_${at}`,
      role: 'assistant' as const,
      content: errorMessage,
      status: 'error' as const,
      createdAt: at,
    }
  }
  const content = extractText(message.content ?? event.content ?? event.delta ?? '')
  if (!content) {
    return null
  }
  return {
    id:
      stringField(event, 'messageId') ??
      stringField(message, 'id') ??
      scalarField(message, 'timestamp') ??
      stringField(event, 'responseId') ??
      stringField(event, 'id') ??
      `${role}_${at}`,
    role,
    content,
    status,
    createdAt: at,
  }
}

function messageFromStoredSessionEvent(
  stored: EventRecord,
  event: Record<string, unknown>,
  status: SessionRuntimeMessage['status'],
) {
  const message = messageFromSessionEvent(event, stored.createdAt, status)
  return message ? { ...message, id: stored.id } : null
}

function messageFromRuntimeError(
  event: Record<string, unknown>,
  at: string,
  fallbackId: string,
): SessionRuntimeMessage {
  const eventId = stringField(event, 'id')
  return {
    id: eventId ? `${eventId}_error` : fallbackId,
    role: 'assistant',
    content: runtimeErrorMessage(event),
    status: 'error',
    createdAt: at,
  }
}

function toolFromSessionEvent(
  event: Record<string, unknown>,
  at: string,
  eventType: string,
): SessionRuntimeToolTrace | null {
  const toolCall = objectValue(event.toolCall ?? event)
  const callId =
    stringField(toolCall, 'id') ??
    stringField(toolCall, 'toolCallId') ??
    stringField(event, 'toolCallId') ??
    stringField(event, 'id')
  if (!callId) {
    return null
  }
  const status = stringField(event, 'status')
  const failed = status === 'error' || Boolean(toolCall.error ?? event.error ?? event.isError)
  const input = toolCall.input ?? toolCall.args ?? event.input ?? event.args
  const output = toolCall.output ?? toolCall.result ?? toolCall.partialResult ?? event.output ?? event.result
  return {
    id: callId,
    callId,
    name:
      stringField(toolCall, 'name') ?? stringField(toolCall, 'toolName') ?? stringField(event, 'toolName') ?? 'tool',
    status: eventType === 'tool_execution_end' ? (failed ? 'error' : 'success') : 'running',
    input,
    output: readableToolValue(output),
    error: failed ? readableContent(toolCall.error ?? event.error) : null,
    durationMs: numberField(toolCall, 'durationMs') ?? numberField(event, 'durationMs'),
    createdAt: at,
    updatedAt: at,
    eventType,
  } satisfies SessionRuntimeToolTrace
}

function upsertMessage(messages: SessionRuntimeMessage[], message: SessionRuntimeMessage) {
  const index = messages.findIndex((item) => item.id === message.id || sameRuntimeMessage(item, message))
  if (index === -1) {
    return [...messages, message]
  }
  const next = [...messages]
  const existing = next[index]
  if (!existing) {
    return [...messages, message]
  }
  next[index] = {
    ...existing,
    ...message,
    content: message.status === 'streaming' ? `${existing.content}${message.content}` : message.content,
  }
  return next
}

function sameRuntimeMessage(left: SessionRuntimeMessage, right: SessionRuntimeMessage) {
  return (
    left.role === right.role &&
    Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt)) < 5000 &&
    normalizeMessageContent(left.content) === normalizeMessageContent(right.content)
  )
}

function dedupeRuntimeMessages(messages: SessionRuntimeMessage[]) {
  return messages.reduce<SessionRuntimeMessage[]>((next, message) => upsertMessage(next, message), [])
}

function normalizeMessageContent(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function upsertTool(tools: SessionRuntimeToolTrace[], tool: SessionRuntimeToolTrace) {
  const runningIndex = findLastToolIndex(tools, (item) => item.callId === tool.callId && item.status === 'running')
  const index =
    tool.eventType === 'tool_execution_start'
      ? runningIndex
      : runningIndex !== -1
        ? runningIndex
        : findLastToolIndex(tools, (item) => item.callId === tool.callId)
  if (index === -1) {
    return [...tools, { ...tool, id: `${tool.callId}:${tool.createdAt}` }]
  }
  const next = [...tools]
  const existing = next[index]
  if (!existing) {
    return [...tools, tool]
  }
  next[index] = {
    ...existing,
    ...tool,
    input: tool.input ?? existing.input,
    output: hasToolValue(tool.output) ? tool.output : existing.output,
    error: tool.error ?? existing.error,
    durationMs:
      tool.durationMs ??
      existing.durationMs ??
      (tool.eventType === 'tool_execution_end' ? elapsedMs(existing.createdAt, tool.updatedAt) : null),
    createdAt: existing.createdAt,
  }
  return next
}

function elapsedMs(start: string, end: string) {
  const elapsed = Date.parse(end) - Date.parse(start)
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : null
}

function findLastToolIndex(tools: SessionRuntimeToolTrace[], predicate: (tool: SessionRuntimeToolTrace) => boolean) {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index]
    if (tool && predicate(tool)) {
      return index
    }
  }
  return -1
}

function runtimeEventKey(event: Record<string, unknown>, eventType: string, turnKey?: string | null) {
  const message = objectValue(event.message)
  const timestamp =
    scalarField(message, 'timestamp') ??
    scalarField(event, 'timestamp') ??
    stringField(event, 'responseId') ??
    stringField(message, 'id')
  const toolCall = objectValue(event.toolCall)
  const toolCallId = stringField(toolCall, 'id') ?? stringField(toolCall, 'toolCallId')
  if (isToolEvent(eventType)) {
    const eventId = stringField(toolCall, 'id') ?? stringField(event, 'id')
    if (eventId) {
      return `${eventType}:id:${eventId}`
    }
    if (!turnKey) {
      return null
    }
    return `${eventType}:${turnKey}:${toolCallId ?? ''}:${stableStringify(toolCall)}`
  }
  if (eventType === 'message_update') {
    if (!timestamp) {
      return null
    }
    return `${eventType}:${timestamp ?? ''}:${stableStringify(message.content ?? event.delta)}`
  }
  if (
    eventType === 'message_start' ||
    eventType === 'message_end' ||
    eventType === 'agent_start' ||
    eventType === 'agent_end' ||
    eventType === 'turn_start' ||
    eventType === 'turn_end'
  ) {
    if (!timestamp) {
      return null
    }
    return `${eventType}:${stringField(message, 'role') ?? ''}:${timestamp}:${stableStringify(message.content)}`
  }
  return `${eventType}:${stableStringify(event)}`
}

function isToolEvent(eventType: string) {
  return (
    eventType === 'tool_execution_start' || eventType === 'tool_execution_update' || eventType === 'tool_execution_end'
  )
}

function isTranscriptEvent(eventType: string) {
  return eventType === 'message_start' || eventType === 'message_update' || eventType === 'message_end'
}

function mergeEventKeys(left: string[], right: string[]) {
  return [...new Set([...left, ...right])].slice(-800)
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return ''
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function runtimeErrorMessage(event: Record<string, unknown>) {
  if (typeof event.error === 'string') {
    return event.error
  }
  const error = objectValue(event.error)
  return readableContent(error.message ?? event.message ?? event.data ?? event.content ?? 'Runtime error')
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    const textItems = value
      .filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text')
      .map((item) => extractText(item))
      .join('')
    return textItems || value.map((item) => extractText(item)).join('')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.type === 'thinking' || record.type === 'toolCall' || record.type === 'toolResult') {
      return ''
    }
    return extractText(record.text ?? record.content ?? record.delta ?? '')
  }
  return ''
}

function readableContent(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value) ?? ''
}

function readableToolValue(value: unknown) {
  if (!value || typeof value !== 'object') {
    return value
  }
  const record = value as Record<string, unknown>
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return ''
        }
        const contentItem = item as Record<string, unknown>
        return contentItem.type === 'text' && typeof contentItem.text === 'string' ? contentItem.text : ''
      })
      .join('')
    return text || value
  }
  return value
}

function hasToolValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return false
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0
  }
  return true
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'string' ? record[field] : null
}

function scalarField(record: Record<string, unknown>, field: string) {
  const value = record[field]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function numberField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'number' ? record[field] : null
}
