import { isPiEventType, piEventCategory, piEventTypeFromPayload } from '@shared/pi-events'
import type { SessionEvent } from '@/lib/api'
import { getStoredAccessToken } from '@/lib/oidc'

export type PiRuntimeConnectionState = 'connecting' | 'open' | 'closed' | 'error'
export type PiRuntimeRunState = 'idle' | 'running' | 'error'

export type PiRpcCommandType = 'get_state' | 'prompt' | 'steer' | 'follow_up' | 'abort'

export interface PiRpcCommand {
  id: string
  type: PiRpcCommandType
  message?: string
}

export interface PiRuntimeMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'streaming' | 'complete' | 'error'
  createdAt: string
}

export interface PiRuntimeToolTrace {
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

export interface PiRuntimeDebugEvent {
  id: string
  type: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface PiRuntimeState {
  connection: PiRuntimeConnectionState
  runState: PiRuntimeRunState
  messages: PiRuntimeMessage[]
  tools: PiRuntimeToolTrace[]
  debugEvents: PiRuntimeDebugEvent[]
  eventKeys: string[]
  error: string | null
}

export type PiRuntimeAction =
  | { type: 'reset' }
  | { type: 'connection'; state: PiRuntimeConnectionState; error?: string | null }
  | { type: 'command_sent'; command: PiRpcCommand; at: string }
  | { type: 'event'; event: Record<string, unknown>; at: string }
  | { type: 'persisted_events'; events: SessionEvent[] }

export const initialPiRuntimeState: PiRuntimeState = {
  connection: 'connecting',
  runState: 'idle',
  messages: [],
  tools: [],
  debugEvents: [],
  eventKeys: [],
  error: null,
}

export function piRuntimeReducer(state: PiRuntimeState, action: PiRuntimeAction): PiRuntimeState {
  if (action.type === 'reset') {
    return initialPiRuntimeState
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

  const eventType = piEventTypeFromPayload(action.event)
  const eventKey = runtimeEventKey(action.event, eventType)
  if (eventKey && state.eventKeys.includes(eventKey)) {
    return state
  }
  const debugEvent: PiRuntimeDebugEvent = {
    id: stringField(action.event, 'id') ?? `${eventType}_${action.at}_${state.debugEvents.length + 1}`,
    type: eventType,
    payload: action.event,
    createdAt: action.at,
  }

  if (!isPiEventType(eventType)) {
    return {
      ...state,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }

  if (eventType === 'response') {
    const success = action.event.success !== false
    const message = success ? null : messageFromRuntimeError(action.event, action.at, debugEvent.id)
    return {
      ...state,
      runState: success ? state.runState : 'error',
      error: success ? null : runtimeErrorMessage(action.event),
      messages: message ? upsertMessage(state.messages, message) : state.messages,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (eventType === 'agent_start' || eventType === 'turn_start' || eventType === 'message_start') {
    return {
      ...state,
      runState: 'running',
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (eventType === 'message' || eventType === 'message_update' || eventType === 'message_end') {
    const message = messageFromPiEvent(
      action.event,
      action.at,
      eventType === 'message_update' ? 'streaming' : 'complete',
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
    const tool = toolFromPiEvent(action.event, action.at, eventType)
    return {
      ...state,
      tools: tool ? upsertTool(state.tools, tool) : state.tools,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (eventType === 'agent_end' || eventType === 'turn_end') {
    const message = messageFromPiEvent(action.event, action.at, 'complete')
    return {
      ...state,
      runState: 'idle',
      messages: message ? upsertMessage(state.messages, message) : state.messages,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (eventType === 'bridge_exit') {
    const failed = action.event.code !== 0 && action.event.code !== null
    const message = failed
      ? messageFromRuntimeError(
          { ...action.event, message: 'Pi runtime exited with an error' },
          action.at,
          debugEvent.id,
        )
      : null
    return {
      ...state,
      runState: failed ? 'error' : 'idle',
      error: failed ? 'Pi runtime exited with an error' : null,
      messages: message ? upsertMessage(state.messages, message) : state.messages,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
      eventKeys: appendEventKey(state.eventKeys, eventKey),
    }
  }
  if (eventType === 'bridge_stderr' || eventType === 'error') {
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
  if (eventType === 'usage') {
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

function mergePersistedEvents(state: PiRuntimeState, events: SessionEvent[]) {
  const runtimeEvents = uniquePersistedRuntimeEvents(events)
  const messages = dedupeRuntimeMessages(
    runtimeEvents
      .map(({ stored, payload }) => {
        const type = runtimeEventType(stored, payload)
        if (type === 'message_end') {
          return messageFromPiEvent(payload, stored.createdAt, 'complete')
        }
        if (type === 'agent_end') {
          return messageFromPiEvent(payload, stored.createdAt, 'complete')
        }
        if (type === 'bridge_exit') {
          const failed = payload.code !== 0 && payload.code !== null
          return failed
            ? messageFromRuntimeError(
                { ...payload, message: 'Pi runtime exited with an error' },
                stored.createdAt,
                stored.id,
              )
            : null
        }
        if (type === 'bridge_stderr' || type === 'error') {
          return messageFromRuntimeError(payload, stored.createdAt, stored.id)
        }
        return null
      })
      .filter((message): message is PiRuntimeMessage => Boolean(message))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
  )
  const tools = runtimeEvents
    .filter(({ stored, payload }) => isToolEvent(runtimeEventType(stored, payload)))
    .map(({ stored, payload }) => toolFromPiEvent(payload, stored.createdAt, runtimeEventType(stored, payload)))
    .filter((tool): tool is PiRuntimeToolTrace => Boolean(tool))
    .reduce<PiRuntimeToolTrace[]>((next, tool) => upsertTool(next, tool), [])
  const debugEvents = runtimeEvents.map(
    ({ stored, payload }): PiRuntimeDebugEvent => ({
      id: stored.id,
      type: runtimeEventType(stored, payload),
      payload,
      createdAt: stored.createdAt,
    }),
  )
  const eventKeys = runtimeEvents
    .map(({ stored, payload }) => runtimeEventKey(payload, runtimeEventType(stored, payload)))
    .filter((key): key is string => Boolean(key))
  const hasTerminalEvent = runtimeEvents.some(({ payload }) => {
    const type = stringField(payload, 'type')
    return type === 'agent_end' || type === 'turn_end' || type === 'bridge_exit'
  })
  const hasErrorEvent = runtimeEvents.some(({ payload }) => {
    const type = stringField(payload, 'type')
    return type === 'error' || type === 'bridge_stderr'
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
      const type = runtimeEventType(stored, payload)
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

function runtimeEventType(stored: SessionEvent, payload: Record<string, unknown>): string {
  const payloadType = piEventTypeFromPayload(payload)
  if (payloadType !== 'message' || payload.type) {
    return payloadType
  }
  return stored.type || 'message'
}

function runtimeTurnKey(event: Record<string, unknown>, eventType: string) {
  if (piEventCategory(eventType) !== 'message') {
    return null
  }
  const message = objectValue(event.message)
  const assistantMessageEvent = objectValue(event.assistantMessageEvent)
  const partial = objectValue(assistantMessageEvent.partial)
  const timestamp =
    scalarField(message, 'timestamp') ??
    scalarField(partial, 'timestamp') ??
    scalarField(event, 'timestamp') ??
    stringField(assistantMessageEvent, 'responseId')
  if (!timestamp) {
    return null
  }
  return `${stringField(message, 'role') ?? ''}:${timestamp}`
}

function messageFromPiEvent(event: Record<string, unknown>, at: string, status: PiRuntimeMessage['status']) {
  const message = objectValue(event.message)
  const assistantMessageEvent = objectValue(event.assistantMessageEvent)
  const partial = objectValue(assistantMessageEvent.partial)
  const rawRole = stringField(message, 'role') ?? stringField(event, 'role') ?? 'assistant'
  if (rawRole === 'toolResult') {
    return null
  }
  const role: PiRuntimeMessage['role'] =
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
  const assistantEventType = stringField(assistantMessageEvent, 'type')
  if (status === 'streaming' && assistantEventType && assistantEventType !== 'text_delta') {
    return null
  }
  const content =
    status === 'streaming' && assistantEventType === 'text_delta'
      ? extractText(assistantMessageEvent.delta)
      : extractText(event.content ?? message.content ?? assistantMessageEvent.text ?? assistantMessageEvent.delta)
  if (!content) {
    return null
  }
  return {
    id:
      stringField(event, 'messageId') ??
      stringField(message, 'id') ??
      scalarField(message, 'timestamp') ??
      scalarField(partial, 'timestamp') ??
      stringField(assistantMessageEvent, 'responseId') ??
      stringField(event, 'id') ??
      `${role}_${at}`,
    role,
    content,
    status,
    createdAt: at,
  }
}

function messageFromRuntimeError(event: Record<string, unknown>, at: string, fallbackId: string): PiRuntimeMessage {
  const eventId = stringField(event, 'id')
  return {
    id: eventId ? `${eventId}_error` : fallbackId,
    role: 'assistant',
    content: runtimeErrorMessage(event),
    status: 'error',
    createdAt: at,
  }
}

function toolFromPiEvent(event: Record<string, unknown>, at: string, eventType: string): PiRuntimeToolTrace | null {
  const toolCall = objectValue(event.toolCall ?? event.call ?? event.toolExecution ?? event)
  const callId = stringField(toolCall, 'id') ?? stringField(toolCall, 'toolCallId') ?? stringField(event, 'id')
  if (!callId) {
    return null
  }
  const failed = Boolean(toolCall.error ?? event.error ?? event.isError)
  const input = toolCall.input ?? toolCall.args ?? event.input
  const output = toolCall.output ?? toolCall.result ?? toolCall.partialResult ?? event.output
  return {
    id: callId,
    callId,
    name: stringField(toolCall, 'name') ?? stringField(toolCall, 'toolName') ?? 'tool',
    status: eventType === 'tool_execution_end' ? (failed ? 'error' : 'success') : 'running',
    input,
    output: readableToolValue(output),
    error: failed ? readableContent(toolCall.error ?? event.error) : null,
    durationMs: numberField(toolCall, 'durationMs') ?? numberField(event, 'durationMs'),
    createdAt: at,
    updatedAt: at,
    eventType,
  } satisfies PiRuntimeToolTrace
}

function upsertMessage(messages: PiRuntimeMessage[], message: PiRuntimeMessage) {
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

function sameRuntimeMessage(left: PiRuntimeMessage, right: PiRuntimeMessage) {
  return (
    left.role === right.role &&
    Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt)) < 5000 &&
    normalizeMessageContent(left.content) === normalizeMessageContent(right.content)
  )
}

function dedupeRuntimeMessages(messages: PiRuntimeMessage[]) {
  return messages.reduce<PiRuntimeMessage[]>((next, message) => upsertMessage(next, message), [])
}

function normalizeMessageContent(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function upsertTool(tools: PiRuntimeToolTrace[], tool: PiRuntimeToolTrace) {
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

function findLastToolIndex(tools: PiRuntimeToolTrace[], predicate: (tool: PiRuntimeToolTrace) => boolean) {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index]
    if (tool && predicate(tool)) {
      return index
    }
  }
  return -1
}

function appendDebugEvent(events: PiRuntimeDebugEvent[], event: PiRuntimeDebugEvent) {
  if (events.some((item) => item.id === event.id)) {
    return events
  }
  return [...events.slice(-199), event]
}

function runtimeEventKey(event: Record<string, unknown>, eventType: string, turnKey?: string | null) {
  const message = objectValue(event.message)
  const assistantMessageEvent = objectValue(event.assistantMessageEvent)
  const partial = objectValue(assistantMessageEvent.partial)
  const timestamp =
    scalarField(message, 'timestamp') ??
    scalarField(partial, 'timestamp') ??
    scalarField(event, 'timestamp') ??
    stringField(assistantMessageEvent, 'responseId')
  const toolCallId =
    stringField(event, 'toolCallId') ??
    stringField(message, 'toolCallId') ??
    stringField(objectValue(event.toolCall), 'id') ??
    stringField(objectValue(event.toolCall), 'toolCallId')
  if (isToolEvent(eventType)) {
    const eventId = stringField(event, 'id')
    if (eventId) {
      return `${eventType}:id:${eventId}`
    }
    if (!turnKey) {
      return null
    }
    return `${eventType}:${turnKey}:${toolCallId ?? ''}:${stableStringify(
      event.args ?? event.result ?? event.partialResult ?? event,
    )}`
  }
  if (eventType === 'message_update') {
    if (!timestamp) {
      return null
    }
    return `${eventType}:${stringField(assistantMessageEvent, 'type') ?? ''}:${timestamp ?? ''}:${stableStringify(
      assistantMessageEvent.delta ?? assistantMessageEvent.content ?? message.content,
    )}`
  }
  if (
    eventType === 'message' ||
    eventType === 'message_start' ||
    eventType === 'message_end' ||
    eventType === 'turn_end'
  ) {
    if (!timestamp) {
      return null
    }
    return `${eventType}:${stringField(message, 'role') ?? ''}:${timestamp ?? ''}:${stableStringify(message.content)}`
  }
  if (eventType === 'response') {
    return `${eventType}:${stringField(event, 'id') ?? ''}:${stringField(event, 'command') ?? ''}:${timestamp ?? ''}`
  }
  if (eventType === 'agent_end') {
    return `${eventType}:${stableStringify(event.messages)}`
  }
  return `${eventType}:${stableStringify(event)}`
}

function isToolEvent(eventType: string) {
  return piEventCategory(eventType) === 'tool'
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
  return readableContent(error.message ?? event.message ?? event.data ?? 'Runtime error')
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
