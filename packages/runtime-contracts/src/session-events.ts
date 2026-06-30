// The session metadata stamp that routes a session's canonical event firehose to
// the per-session Session DO (SQLite hot + R2 cold). Written by the cloud-loop
// (ama) start path; read by the event-store router. Absent ⇒ events live on D1
// (pre-migration cloud sessions, self-hosted CLI sessions).
export const SESSION_DO_EVENT_STORE = 'session-do'

export const AMA_SESSION_EVENT_TYPES = [
  'agent.started',
  'agent.completed',
  'turn.started',
  'turn.completed',
  'session.stopped',
  'session.checkpointed',
  'session.resumed',
  'message.started',
  'message.updated',
  'message.completed',
  'tool_call.started',
  'tool_call.updated',
  'tool_call.completed',
  'usage.recorded',
  'permission.requested',
  'permission.resolved',
  'permission.denied',
  'runtime.error',
  'runtime.status',
  'runtime.output',
  'runner.status',
] as const

export type AmaSessionEventType = (typeof AMA_SESSION_EVENT_TYPES)[number]
const AMA_SESSION_EVENT_TYPE_SET = new Set<string>(AMA_SESSION_EVENT_TYPES)

export type EventMetadata = {
  sourceEventType?: string
  runtimeSource?: string
  source?: string
  producer?: string
  provider?: string
  model?: string
  raw?: unknown
  [key: string]: unknown
}

export type TextContentBlock = { type: 'text'; text: string }
export type ReasoningContentBlock = { type: 'reasoning'; text: string }
export type ToolCallContentBlock = { type: 'tool_call'; toolCall: ToolCall }
export type ToolResultContentBlock = { type: 'tool_result'; toolCallId: string; result: unknown; isError?: boolean }
export type ImageContentBlock = { type: 'image'; url?: string; mediaType?: string; data?: string }
export type FileContentBlock = { type: 'file'; path?: string; name?: string; mediaType?: string; data?: string }
export type UnknownContentBlock = { type: 'unknown'; value: unknown }

export type MessageContentBlock =
  | TextContentBlock
  | ReasoningContentBlock
  | ToolCallContentBlock
  | ToolResultContentBlock
  | ImageContentBlock
  | FileContentBlock
  | UnknownContentBlock

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'toolResult'

export type Message = {
  id?: string
  role: MessageRole
  content: MessageContentBlock[]
  timestamp?: number
  stopReason?: string
}

export type ToolCall = {
  id: string
  name: string
  input: unknown
}

export type ToolResult = {
  content?: unknown
  metadata?: Record<string, unknown>
}

export type EventError = {
  message: string
  code?: string
  category?: string
  retryable?: boolean
  retryAfterSeconds?: number
  provider?: string
  model?: string
  details?: unknown
}

export type MessageEventPayload = { message: Message; [key: string]: unknown }
export type ToolStartedPayload = { toolCall: ToolCall; [key: string]: unknown }
export type ToolUpdatedPayload = { toolCall: ToolCall; partialResult?: unknown; [key: string]: unknown }
export type ToolCompletedPayload = {
  toolCall: ToolCall
  result?: unknown
  error?: EventError
  isError?: boolean
  durationMs?: number
  [key: string]: unknown
}
export type TurnPayload = {
  marker?: string
  stage?: string
  status?: string
  [key: string]: unknown
}
export type SessionStopPayload = { reason?: string }
export type SessionCheckpointPayload = { resumeTokenRef?: string; scope?: string; [key: string]: unknown }
export type SessionResumePayload = { fromCheckpoint?: string; reason?: string; [key: string]: unknown }
export type UsageRecordedPayload = {
  provider?: string
  model?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  toolTokens?: number
  costMicros?: number
  details?: Record<string, unknown>
}
export type PermissionDeniedPayload = {
  reason?: string
  resourceType?: string
  resourceId?: string
  operation?: string
  command?: string | null
  host?: string | null
  connectorId?: string
  toolName?: string
  details?: Record<string, unknown>
}
export type PermissionRequestPayload = {
  permissionId?: string
  command?: string
  toolCall?: ToolCall
  details?: Record<string, unknown>
}
export type PermissionResolvedPayload = {
  permissionId?: string
  allowed: boolean
  reason?: string
  toolCall?: ToolCall
  details?: Record<string, unknown>
}
export type RuntimeErrorPayload = EventError
export type RuntimeOutputPayload = {
  stream: 'stdout' | 'stderr' | 'runtime' | 'reasoning' | 'bridge'
  content: unknown
}
export type StatusPayload = { data: Record<string, unknown> }

export type AmaEventPayloadByType = {
  'agent.started': Record<string, unknown>
  'agent.completed': Record<string, unknown>
  'turn.started': TurnPayload
  'turn.completed': TurnPayload
  'session.stopped': SessionStopPayload
  'session.checkpointed': SessionCheckpointPayload
  'session.resumed': SessionResumePayload
  'message.started': MessageEventPayload
  'message.updated': MessageEventPayload
  'message.completed': MessageEventPayload
  'tool_call.started': ToolStartedPayload
  'tool_call.updated': ToolUpdatedPayload
  'tool_call.completed': ToolCompletedPayload
  'usage.recorded': UsageRecordedPayload
  'permission.requested': PermissionRequestPayload
  'permission.resolved': PermissionResolvedPayload
  'permission.denied': PermissionDeniedPayload
  'runtime.error': RuntimeErrorPayload
  'runtime.status': StatusPayload
  'runtime.output': RuntimeOutputPayload
  'runner.status': StatusPayload
}

export type AmaEvent<TType extends AmaSessionEventType = AmaSessionEventType> = {
  [K in TType]: {
    type: K
    payload: AmaEventPayloadByType[K]
    metadata?: EventMetadata
  }
}[TType]

export type EventRecord = {
  id: string
  projectId: string
  sessionId: string
  sequence: number
  createdAt: string
  event: AmaEvent
}

export function isAmaSessionEventType(value: string): value is AmaSessionEventType {
  return AMA_SESSION_EVENT_TYPE_SET.has(value)
}

export function amaSessionEventTypeFromPayload(event: Record<string, unknown>): string {
  return typeof event.type === 'string' && event.type ? event.type : 'unknown'
}

const PI_CORE_TO_AMA_EVENT_TYPE = new Map<string, AmaSessionEventType>([
  ['agent_start', 'agent.started'],
  ['agent_end', 'agent.completed'],
  ['turn_start', 'turn.started'],
  ['turn_end', 'turn.completed'],
  ['message_start', 'message.started'],
  ['message_update', 'message.updated'],
  ['message_end', 'message.completed'],
  ['tool_execution_start', 'tool_call.started'],
  ['tool_execution_update', 'tool_call.updated'],
  ['tool_execution_end', 'tool_call.completed'],
])

export function isPiCoreSourceEventType(value: string) {
  return PI_CORE_TO_AMA_EVENT_TYPE.has(value)
}

export function amaEventFromRuntimeEvent(event: Record<string, unknown>, metadata: EventMetadata = {}): AmaEvent {
  const sourceEventType = sourceEventTypeFromRuntimeEvent(event)
  const type = canonicalType(sourceEventType)
  const payload = canonicalPayload(type, sourceEventType, event)
  return {
    type,
    payload,
    metadata: {
      ...metadata,
      sourceEventType,
      runtimeSource: metadata.runtimeSource ?? metadata.source ?? 'runtime',
    },
  } as AmaEvent
}

export function normalizeAmaEvent(event: AmaEvent): AmaEvent {
  return { type: event.type, payload: event.payload, metadata: event.metadata ?? {} } as AmaEvent
}

function sourceEventTypeFromRuntimeEvent(event: Record<string, unknown>) {
  return typeof event.type === 'string' && event.type ? event.type : 'message'
}

function canonicalType(sourceEventType: string): AmaSessionEventType {
  const piEventType = PI_CORE_TO_AMA_EVENT_TYPE.get(sourceEventType)
  if (piEventType) return piEventType
  if (isAmaSessionEventType(sourceEventType)) return sourceEventType
  if (matchesRuntimeEvent(sourceEventType, 'usage')) return 'usage.recorded'
  if (matchesRuntimeEvent(sourceEventType, 'error')) return 'runtime.error'
  if (matchesRuntimeEvent(sourceEventType, 'output')) return 'runtime.output'
  if (sourceEventType === 'usage') return 'usage.recorded'
  if (sourceEventType === 'permission_denied' || sourceEventType === 'policy_denied') return 'permission.denied'
  if (sourceEventType === 'error') return 'runtime.error'
  if (sourceEventType === 'bridge_stderr') return 'runtime.output'
  if (sourceEventType === 'bridge_exit') return 'runtime.error'
  if (sourceEventType === 'queue_update' || sourceEventType === 'session_info_changed') return 'runtime.status'
  if (sourceEventType === 'runner_heartbeat' || sourceEventType === 'runner_status') return 'runner.status'
  return 'runtime.status'
}

function matchesRuntimeEvent(sourceEventType: string, suffix: string) {
  return (
    sourceEventType === `runner.${suffix}` ||
    sourceEventType === `ama.${suffix}` ||
    sourceEventType === `claude-code.${suffix}` ||
    sourceEventType === `codex.${suffix}` ||
    sourceEventType === `copilot.${suffix}`
  )
}

function canonicalPayload(
  type: AmaSessionEventType,
  sourceEventType: string,
  event: Record<string, unknown>,
): AmaEventPayloadByType[AmaSessionEventType] {
  if (PI_CORE_TO_AMA_EVENT_TYPE.has(sourceEventType)) {
    return normalizeKnownPayload(type, withoutType(event))
  }

  if (type === 'usage.recorded') {
    return usagePayload(event)
  }

  if (type === 'permission.denied') {
    return compactObject({
      reason: event.reason ?? event.message ?? (event.category === 'approval' ? 'approval_required' : undefined),
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      operation: event.operation,
      command: event.command,
      host: event.host,
      connectorId: event.connectorId,
      toolName: event.toolName,
      details: compactObject({
        category: event.category,
        ruleId: event.ruleId,
        decision: event.decision,
        ...restObject(event, [
          'type',
          'allowed',
          'reason',
          'message',
          'category',
          'ruleId',
          'resourceType',
          'resourceId',
          'operation',
          'command',
          'host',
          'connectorId',
          'toolName',
          'decision',
        ]),
      }),
    }) as PermissionDeniedPayload
  }

  if (type === 'runtime.error') {
    const error = objectValue(event.error)
    return compactObject({
      message: runtimeErrorMessage(event, sourceEventType),
      code: event.code ?? error.code,
      signal: event.signal,
      details: error.details ?? event.details,
      // Normalized provider error envelope: stable category enum plus retry
      // metadata, attached by the provider adapter seam.
      ...(typeof event.category === 'string' ? { category: event.category } : {}),
      ...(typeof event.retryable === 'boolean' ? { retryable: event.retryable } : {}),
      ...(numberField(event, 'retryAfterSeconds') !== null ? { retryAfterSeconds: event.retryAfterSeconds } : {}),
      ...(typeof event.provider === 'string' ? { provider: event.provider } : {}),
      ...(typeof event.model === 'string' ? { model: event.model } : {}),
    }) as RuntimeErrorPayload
  }

  if (type === 'runtime.output') {
    return {
      stream: runtimeOutputStream(event, sourceEventType),
      content: event.data ?? event.message ?? event.output ?? event.content ?? '',
    }
  }

  if (type === 'runtime.status' || type === 'runner.status') {
    const { type: _type, ...data } = event
    return { data: objectValue(data.data ?? data) }
  }

  return normalizeKnownPayload(type, withoutType(event))
}

function normalizeKnownPayload(
  type: AmaSessionEventType,
  payload: Record<string, unknown>,
): AmaEventPayloadByType[AmaSessionEventType] {
  if (type === 'message.started' || type === 'message.updated' || type === 'message.completed') {
    return { ...restObject(payload, ['message']), message: normalizeMessage(payload.message ?? payload) }
  }
  if (type === 'tool_call.started') {
    return {
      ...restObject(payload, ['toolCall', 'toolCallId', 'toolName', 'input', 'arguments', 'args']),
      toolCall: normalizeToolCall(payload),
    }
  }
  if (type === 'tool_call.updated') {
    return compactObject({
      ...restObject(payload, [
        'toolCall',
        'toolCallId',
        'toolName',
        'input',
        'arguments',
        'args',
        'partialResult',
        'result',
        'output',
      ]),
      toolCall: normalizeToolCall(payload),
      partialResult: payload.partialResult ?? payload.result ?? payload.output,
    }) as ToolUpdatedPayload
  }
  if (type === 'tool_call.completed') {
    const isError = payload.isError === true || Boolean(payload.error)
    return compactObject({
      ...restObject(payload, [
        'toolCall',
        'toolCallId',
        'toolName',
        'input',
        'arguments',
        'args',
        'result',
        'output',
        'error',
        'isError',
        'durationMs',
      ]),
      toolCall: normalizeToolCall(payload),
      result: payload.result ?? payload.output,
      error: payload.error ? normalizeError(payload.error) : undefined,
      isError,
      durationMs: numberField(payload, 'durationMs') ?? undefined,
    }) as ToolCompletedPayload
  }
  if (type === 'turn.started' || type === 'turn.completed') {
    return compactObject({
      ...restObject(payload, ['marker', 'stage', 'status']),
      marker: payload.marker,
      stage: payload.stage,
      status: payload.status,
    }) as TurnPayload
  }
  if (type === 'session.stopped')
    return compactObject({ ...restObject(payload, ['reason']), reason: payload.reason }) as SessionStopPayload
  if (type === 'session.checkpointed') {
    return compactObject({
      ...restObject(payload, ['resumeTokenRef', 'scope']),
      resumeTokenRef: payload.resumeTokenRef,
      scope: payload.scope,
    }) as SessionCheckpointPayload
  }
  if (type === 'session.resumed') {
    return compactObject({
      ...restObject(payload, ['fromCheckpoint', 'reason']),
      fromCheckpoint: payload.fromCheckpoint,
      reason: payload.reason,
    }) as SessionResumePayload
  }
  if (type === 'usage.recorded') return usagePayload(payload)
  if (type === 'permission.requested') {
    return compactObject({
      permissionId: payload.permissionId,
      command: payload.command,
      toolCall: payload.toolCall ? normalizeToolCall(objectValue(payload.toolCall)) : undefined,
      details: restObject(payload, ['permissionId', 'command', 'toolCall']),
    }) as PermissionRequestPayload
  }
  if (type === 'permission.resolved') {
    return compactObject({
      permissionId: payload.permissionId,
      allowed: payload.allowed === true,
      reason: payload.reason,
      toolCall: payload.toolCall ? normalizeToolCall(objectValue(payload.toolCall)) : undefined,
      details: restObject(payload, ['permissionId', 'allowed', 'reason', 'toolCall']),
    }) as PermissionResolvedPayload
  }
  if (type === 'runtime.error') return normalizeError(payload)
  if (type === 'runtime.output') {
    return {
      stream: runtimeOutputStream(payload, type),
      content: payload.content ?? payload.message ?? payload.data ?? '',
    }
  }
  if (type === 'runtime.status' || type === 'runner.status') return { data: objectValue(payload.data ?? payload) }
  return payload
}

export function normalizeMessage(value: unknown): Message {
  const message = objectValue(value)
  const role = messageRole(stringField(message, 'role'))
  return compactObject({
    id: stringField(message, 'id') ?? undefined,
    role,
    content: normalizeContentBlocks(message.content ?? message.text ?? message.delta ?? ''),
    timestamp: numberField(message, 'timestamp') ?? undefined,
    stopReason: stringField(message, 'stopReason') ?? undefined,
  }) as Message
}

function normalizeContentBlocks(value: unknown): MessageContentBlock[] {
  if (typeof value === 'string') {
    return value ? [{ type: 'text', text: value }] : []
  }
  if (!Array.isArray(value)) {
    return value === undefined || value === null ? [] : [{ type: 'unknown', value }]
  }
  return value.flatMap((item): MessageContentBlock[] => {
    if (typeof item === 'string') return item ? [{ type: 'text', text: item }] : []
    const block = objectValue(item)
    switch (block.type) {
      case 'text':
        return typeof block.text === 'string' ? [{ type: 'text', text: block.text }] : []
      case 'thinking':
      case 'reasoning':
        return typeof block.text === 'string'
          ? [{ type: 'reasoning', text: block.text }]
          : typeof block.thinking === 'string'
            ? [{ type: 'reasoning', text: block.thinking }]
            : []
      case 'tool_call':
      case 'toolCall':
      case 'tool_use':
        return [{ type: 'tool_call', toolCall: normalizeToolCall(block.toolCall ?? block) }]
      case 'tool_result':
      case 'toolResult':
        return [
          {
            type: 'tool_result',
            toolCallId: stringField(block, 'toolCallId') ?? stringField(block, 'tool_use_id') ?? '',
            result: block.result ?? block.content,
            ...(typeof block.isError === 'boolean' ? { isError: block.isError } : {}),
          },
        ]
      case 'image':
        return [
          compactObject({
            type: 'image',
            url: block.url,
            mediaType: block.mediaType,
            data: block.data,
          }) as ImageContentBlock,
        ]
      case 'file':
        return [
          compactObject({
            type: 'file',
            path: block.path,
            name: block.name,
            mediaType: block.mediaType,
            data: block.data,
          }) as FileContentBlock,
        ]
      default:
        return [{ type: 'unknown', value: item }]
    }
  })
}

function normalizeToolCall(value: unknown): ToolCall {
  const record = objectValue(value)
  const nested = objectValue(record.toolCall)
  const source = Object.keys(nested).length > 0 ? nested : record
  return {
    id: stringField(source, 'id') ?? stringField(source, 'toolCallId') ?? stringField(record, 'toolCallId') ?? 'tool',
    name: stringField(source, 'name') ?? stringField(source, 'toolName') ?? stringField(record, 'toolName') ?? 'tool',
    input: source.input ?? source.arguments ?? source.args ?? record.input ?? record.arguments ?? record.args ?? {},
  }
}

function usagePayload(event: Record<string, unknown>): UsageRecordedPayload {
  return compactObject({
    provider: event.provider,
    model: event.model,
    promptTokens: event.promptTokens,
    completionTokens: event.completionTokens,
    totalTokens: event.totalTokens,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cachedInputTokens: event.cachedInputTokens,
    reasoningTokens: event.reasoningTokens,
    toolTokens: event.toolTokens,
    costMicros: event.costMicros,
    details: restObject(event, [
      'type',
      'provider',
      'model',
      'promptTokens',
      'completionTokens',
      'totalTokens',
      'inputTokens',
      'outputTokens',
      'cachedInputTokens',
      'reasoningTokens',
      'toolTokens',
      'costMicros',
    ]),
  }) as UsageRecordedPayload
}

function normalizeError(value: unknown): RuntimeErrorPayload {
  if (typeof value === 'string') return { message: value }
  const error = objectValue(value)
  return compactObject({
    message: stringField(error, 'message') ?? 'Runtime error',
    code: error.code,
    category: error.category,
    retryable: error.retryable,
    retryAfterSeconds: error.retryAfterSeconds,
    provider: error.provider,
    model: error.model,
    details:
      error.details ??
      restObject(error, ['message', 'code', 'category', 'retryable', 'retryAfterSeconds', 'provider', 'model']),
  }) as RuntimeErrorPayload
}

function runtimeErrorMessage(event: Record<string, unknown>, sourceEventType: string) {
  if (sourceEventType === 'bridge_exit') {
    return 'Runtime process exited with an error'
  }
  if (typeof event.error === 'string') {
    return event.error
  }
  const error = objectValue(event.error)
  return stringField(error, 'message') ?? stringField(event, 'message') ?? String(event.data ?? 'Runtime error')
}

function runtimeOutputStream(event: Record<string, unknown>, sourceEventType: string) {
  if (sourceEventType === 'bridge_stderr') {
    return 'stderr'
  }
  const stream = event.stream
  if (stream === 'stdout' || stream === 'stderr') {
    return stream
  }
  return 'runtime'
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function messageRole(value: string | null): MessageRole {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool' || value === 'toolResult'
    ? value
    : 'assistant'
}

function withoutType(event: Record<string, unknown>) {
  const { type: _type, ...payload } = event
  return payload
}

function compactObject<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>
}

function restObject(record: Record<string, unknown>, omitted: string[]): Record<string, unknown> | undefined {
  const omittedSet = new Set(omitted)
  const rest = Object.fromEntries(
    Object.entries(record).filter(([key, value]) => !omittedSet.has(key) && value !== undefined),
  )
  return Object.keys(rest).length > 0 ? rest : undefined
}
