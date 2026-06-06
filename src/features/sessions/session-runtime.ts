import {
  type AmaSessionEventType,
  amaSessionEventCategory,
  amaSessionEventTypeFromPayload,
  isAmaSessionEventType,
} from '@shared/session-events'
import type { SessionEvent } from '@/lib/api'
import { getStoredAccessToken } from '@/lib/oidc'

export type SessionRuntimeConnectionState = 'connecting' | 'open' | 'closed' | 'error'
export type SessionRuntimeRunState = 'idle' | 'running' | 'error'

export type RuntimeRpcCommandType = 'get_state' | 'prompt' | 'steer' | 'follow_up' | 'abort'

export interface RuntimeRpcCommand {
  id: string
  type: RuntimeRpcCommandType
  message?: string
}

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
  | { type: 'command_sent'; command: RuntimeRpcCommand; at: string }
  | { type: 'event'; event: Record<string, unknown>; at: string }
  | { type: 'persisted_events'; events: SessionEvent[] }

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
  if (action.type === 'command_sent') {
    if (!action.command.message) {
      return state
    }
    return {
      ...state,
      runState: action.command.type === 'abort' ? state.runState : 'running',
      messages: upsertMessage(state.messages, {
        id: action.command.id,
        role: 'user',
        content: action.command.message,
        status: 'complete',
        createdAt: action.at,
      }),
    }
  }

  const eventType = amaSessionEventTypeFromPayload(action.event)
  if (!isAmaSessionEventType(eventType)) {
    return state
  }
  const eventKey = runtimeEventKey(action.event, eventType)
  if (eventKey && state.eventKeys.includes(eventKey)) {
    return state
  }
  const debugEvent: SessionRuntimeDebugEvent = {
    id: stringField(action.event, 'id') ?? `${eventType}_${action.at}_${state.debugEvents.length + 1}`,
    type: eventType,
    payload: action.event,
    createdAt: action.at,
  }

  if (eventType === 'agent_start' || eventType === 'turn_start' || eventType === 'agent_end' || eventType === 'turn_end') {
    const terminal = eventType === 'agent_end' || eventType === 'turn_end'
    return {
      ...state,
      runState: terminal ? 'idle' : 'running',
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (eventType === 'message_start' || eventType === 'message_update' || eventType === 'message_end') {
    const message = messageFromSessionEvent(
      action.event,
      action.at,
      eventType === 'message_end' ? 'complete' : 'streaming',
    )
    return {
      ...state,
      messages: message ? upsertMessage(state.messages, message) : state.messages,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (
    eventType === 'tool_execution_start' ||
    eventType === 'tool_execution_update' ||
    eventType === 'tool_execution_end'
  ) {
    const tool = toolFromSessionEvent(action.event, action.at, eventType)
    return {
      ...state,
      tools: tool ? upsertTool(state.tools, tool) : state.tools,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (eventType === 'runtime.error') {
    const message = messageFromRuntimeError(action.event, action.at, debugEvent.id)
    return {
      ...state,
      runState: 'error',
      error: runtimeErrorMessage(action.event),
      messages: upsertMessage(state.messages, message),
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (
    eventType === 'usage.recorded' ||
    eventType === 'runtime.output' ||
    eventType === 'runtime.metadata' ||
    eventType === 'runner.metadata' ||
    eventType === 'policy.decision'
  ) {
    return {
      ...state,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  return {
    ...state,
    debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
    eventKeys: appendEventKey(state.eventKeys, eventKey),
  }
}

export function runtimeWebSocketUrl(runtimeEndpointPath: string) {
  const runtimePath = runtimeEndpointPath.endsWith('/rpc')
    ? runtimeEndpointPath.replace(/\/rpc$/, '/ws')
    : `${runtimeEndpointPath.replace(/\/$/, '')}/ws`
  const url = new URL(runtimePath, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const accessToken = getStoredAccessToken()
  if (accessToken) {
    url.searchParams.set('access_token', accessToken)
  }
  return url.toString()
}

function mergePersistedEvents(state: SessionRuntimeState, events: SessionEvent[]) {
  const runtimeEvents = uniquePersistedRuntimeEvents(events)
  const messages = dedupeRuntimeMessages(
    runtimeEvents
      .map(({ stored, payload }) => {
        const type = sessionEventType(stored, payload)
        if (type === 'message_end') {
          return messageFromSessionEvent(payload, stored.createdAt, 'complete')
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
    return stored.type === 'runtime.error'
  })
  return {
    ...state,
    runState: hasErrorEvent ? 'error' : hasTerminalEvent ? 'idle' : state.runState,
    messages: [
      ...messages,
      ...state.messages.filter(
        (item) => !messages.some((message) => message.id === item.id || sameRuntimeMessage(message, item)),
      ),
    ],
    tools: [...tools, ...state.tools.filter((item) => !tools.some((tool) => tool.id === item.id))],
    debugEvents: [
      ...debugEvents,
      ...state.debugEvents.filter((item) => !debugEvents.some((event) => event.id === item.id)),
    ],
    eventKeys: mergeEventKeys(eventKeys, state.eventKeys),
  }
}

type StoredRuntimeEvent = {
  stored: SessionEvent
  payload: Record<string, unknown>
}

function uniquePersistedRuntimeEvents(events: SessionEvent[]): StoredRuntimeEvent[] {
  const seen = new Set<string>()
  let turnKey: string | null = null
  const uniqueEvents: StoredRuntimeEvent[] = []
  events
    .filter((event) => event.visibility === 'runtime')
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((stored) => {
      const payload = objectValue(stored.payload)
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

function sessionEventType(stored: SessionEvent, _payload: Record<string, unknown>): AmaSessionEventType {
  return stored.type
}

function runtimeTurnKey(event: Record<string, unknown>, eventType: string) {
  if (amaSessionEventCategory(eventType) !== 'transcript') {
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
    name: stringField(toolCall, 'name') ?? stringField(toolCall, 'toolName') ?? stringField(event, 'toolName') ?? 'tool',
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
    durationMs: tool.durationMs ?? existing.durationMs,
    createdAt: existing.createdAt,
  }
  return next
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

function appendDebugEvent(events: SessionRuntimeDebugEvent[], event: SessionRuntimeDebugEvent) {
  if (events.some((item) => item.id === event.id)) {
    return events
  }
  return [...events.slice(-199), event]
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
  return amaSessionEventCategory(eventType) === 'tool'
}

function appendEventKey(keys: string[], key: string | null) {
  if (!key || keys.includes(key)) {
    return keys
  }
  return [...keys.slice(-799), key]
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
