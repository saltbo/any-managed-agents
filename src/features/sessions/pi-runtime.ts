import type { SessionEvent } from '@/lib/api'

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
  name: string
  status: 'running' | 'success' | 'error'
  input: unknown
  output: unknown
  error: string | null
  durationMs: number | null
  updatedAt: string
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
  error: string | null
}

export type PiRuntimeAction =
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
  error: null,
}

export function piRuntimeReducer(state: PiRuntimeState, action: PiRuntimeAction): PiRuntimeState {
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

  const eventType = stringField(action.event, 'type') ?? 'event'
  const debugEvent: PiRuntimeDebugEvent = {
    id: stringField(action.event, 'id') ?? `${eventType}_${action.at}_${state.debugEvents.length + 1}`,
    type: eventType,
    payload: action.event,
    createdAt: action.at,
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
    }
  }
  if (eventType === 'agent_start' || eventType === 'turn_start' || eventType === 'message_start') {
    return {
      ...state,
      runState: 'running',
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
    }
  }
  if (eventType === 'message_update' || eventType === 'message_end') {
    const message = messageFromPiEvent(
      action.event,
      action.at,
      eventType === 'message_update' ? 'streaming' : 'complete',
    )
    return {
      ...state,
      messages: message ? upsertMessage(state.messages, message) : state.messages,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
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
    }
  }
  if (eventType === 'agent_end' || eventType === 'turn_end') {
    const message = messageFromPiEvent(action.event, action.at, 'complete')
    return {
      ...state,
      runState: 'idle',
      messages: message ? upsertMessage(state.messages, message) : state.messages,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
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
    }
  }
  if (eventType === 'usage') {
    return {
      ...state,
      debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
    }
  }
  return {
    ...state,
    debugEvents: appendDebugEvent(state.debugEvents, debugEvent),
  }
}

export function runtimeWebSocketUrl(runtimeEndpointPath: string) {
  const runtimePath = runtimeEndpointPath.endsWith('/rpc')
    ? runtimeEndpointPath.replace(/\/rpc$/, '/ws')
    : `${runtimeEndpointPath.replace(/\/$/, '')}/ws`
  const url = new URL(runtimePath, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function mergePersistedEvents(state: PiRuntimeState, events: SessionEvent[]) {
  const runtimeEvents = events
    .filter((event) => event.visibility === 'runtime')
    .map((event) => ({ stored: event, payload: objectValue(event.payload) }))
  const messages = dedupeRuntimeMessages(
    runtimeEvents
      .map(({ stored, payload }) => {
        const type = stringField(payload, 'type') ?? stored.type
        if (type === 'message_update' || type === 'message_end') {
          return messageFromPiEvent(payload, stored.createdAt, type === 'message_update' ? 'streaming' : 'complete')
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
  const tools = events
    .filter(
      (event) =>
        event.visibility === 'runtime' &&
        (event.type === 'tool_execution_start' ||
          event.type === 'tool_execution_update' ||
          event.type === 'tool_execution_end' ||
          event.type === 'tool_call' ||
          event.type === 'tool_result'),
    )
    .map((event) => toolFromPiEvent(objectValue(event.payload), event.createdAt, event.type))
    .filter((tool): tool is PiRuntimeToolTrace => Boolean(tool))
  const debugEvents = events
    .filter((event) => event.visibility === 'runtime')
    .map(
      (event): PiRuntimeDebugEvent => ({
        id: event.id,
        type: event.type,
        payload: objectValue(event.payload),
        createdAt: event.createdAt,
      }),
    )
  return {
    ...state,
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
  }
}

function messageFromPiEvent(event: Record<string, unknown>, at: string, status: PiRuntimeMessage['status']) {
  const message = objectValue(event.message)
  const assistantMessageEvent = objectValue(event.assistantMessageEvent)
  const role = stringField(message, 'role') ?? stringField(event, 'role') ?? 'assistant'
  if (role === 'user') {
    return null
  }
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
  const content = extractText(
    event.content ?? message.content ?? assistantMessageEvent.text ?? assistantMessageEvent.delta,
  )
  if (!content) {
    return null
  }
  return {
    id:
      stringField(event, 'messageId') ?? stringField(message, 'id') ?? stringField(event, 'id') ?? 'assistant_current',
    role: 'assistant' as const,
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
  const id = stringField(toolCall, 'id') ?? stringField(toolCall, 'toolCallId') ?? stringField(event, 'id')
  if (!id) {
    return null
  }
  const failed = Boolean(toolCall.error ?? event.error)
  return {
    id,
    name: stringField(toolCall, 'name') ?? stringField(toolCall, 'toolName') ?? 'tool',
    status: eventType === 'tool_execution_end' ? (failed ? 'error' : 'success') : 'running',
    input: toolCall.input ?? toolCall.args ?? event.input,
    output: toolCall.output ?? toolCall.result ?? event.output,
    error: failed ? readableContent(toolCall.error ?? event.error) : null,
    durationMs: numberField(toolCall, 'durationMs') ?? numberField(event, 'durationMs'),
    updatedAt: at,
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
    left.status === right.status &&
    normalizeMessageContent(left.content) === normalizeMessageContent(right.content)
  )
}

function dedupeRuntimeMessages(messages: PiRuntimeMessage[]) {
  return messages.reduce<PiRuntimeMessage[]>((next, message) => {
    if (!next.some((item) => item.id === message.id || sameRuntimeMessage(item, message))) {
      next.push(message)
    }
    return next
  }, [])
}

function normalizeMessageContent(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function upsertTool(tools: PiRuntimeToolTrace[], tool: PiRuntimeToolTrace) {
  const index = tools.findIndex((item) => item.id === tool.id)
  if (index === -1) {
    return [...tools, tool]
  }
  const next = [...tools]
  next[index] = { ...next[index], ...tool }
  return next
}

function appendDebugEvent(events: PiRuntimeDebugEvent[], event: PiRuntimeDebugEvent) {
  if (events.some((item) => item.id === event.id)) {
    return events
  }
  return [...events.slice(-199), event]
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
    return value.map((item) => extractText(item)).join('')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'string' ? record[field] : null
}

function numberField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'number' ? record[field] : null
}
