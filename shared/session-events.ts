export const AMA_SESSION_EVENT_DEFINITIONS = {
  'session.lifecycle': { category: 'lifecycle', label: 'Session lifecycle' },
  'transcript.message': { category: 'transcript', label: 'Transcript message' },
  'transcript.message.delta': { category: 'transcript', label: 'Transcript delta' },
  'tool_call.started': { category: 'tool', label: 'Tool started' },
  'tool_call.updated': { category: 'tool', label: 'Tool updated' },
  'tool_call.completed': { category: 'tool', label: 'Tool completed' },
  'usage.recorded': { category: 'usage', label: 'Usage recorded' },
  'policy.decision': { category: 'policy', label: 'Policy decision' },
  'runtime.error': { category: 'error', label: 'Runtime error' },
  'runtime.metadata': { category: 'metadata', label: 'Runtime metadata' },
  'runtime.output': { category: 'output', label: 'Runtime output' },
  'runner.metadata': { category: 'metadata', label: 'Runner metadata' },
} as const

export type AmaSessionEventType = keyof typeof AMA_SESSION_EVENT_DEFINITIONS
export type AmaSessionEventCategory = (typeof AMA_SESSION_EVENT_DEFINITIONS)[AmaSessionEventType]['category']

export const AMA_SESSION_EVENT_TYPES = Object.keys(AMA_SESSION_EVENT_DEFINITIONS) as AmaSessionEventType[]
export const AMA_SESSION_EVENT_CATEGORIES = [
  'transcript',
  'tool',
  'lifecycle',
  'usage',
  'policy',
  'error',
  'metadata',
  'output',
] as const satisfies readonly Exclude<AmaSessionEventCategory, 'unknown'>[]

export type AmaSessionEventFilterCategory = AmaSessionEventCategory | 'unknown'

export type CanonicalAmaSessionEvent = {
  type: AmaSessionEventType
  payload: Record<string, unknown>
  visibility: 'runtime' | 'transcript' | 'debug' | 'audit'
  role: string | null
  metadata: Record<string, unknown>
}

export function isAmaSessionEventType(value: string): value is AmaSessionEventType {
  return Object.hasOwn(AMA_SESSION_EVENT_DEFINITIONS, value)
}

export function amaSessionEventCategory(type: string): AmaSessionEventFilterCategory {
  return isAmaSessionEventType(type) ? AMA_SESSION_EVENT_DEFINITIONS[type].category : 'unknown'
}

export function amaSessionEventLabel(type: string): string {
  return isAmaSessionEventType(type) ? AMA_SESSION_EVENT_DEFINITIONS[type].label : type
}

export function amaSessionEventTypeFromPayload(event: Record<string, unknown>): string {
  return typeof event.type === 'string' && event.type ? event.type : 'unknown'
}

export function canonicalAmaSessionEventFromRuntimeEvent(
  event: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): CanonicalAmaSessionEvent {
  const sourceEventType = sourceEventTypeFromRuntimeEvent(event)
  const type = canonicalType(sourceEventType, event)
  return {
    type,
    payload: canonicalPayload(type, sourceEventType, event),
    visibility: 'runtime',
    role: canonicalRole(type, event),
    metadata: {
      ...metadata,
      sourceEventType,
      runtimeSource: metadata.runtimeSource ?? metadata.source ?? 'runtime',
    },
  }
}

function sourceEventTypeFromRuntimeEvent(event: Record<string, unknown>) {
  return typeof event.type === 'string' && event.type ? event.type : 'message'
}

function canonicalType(sourceEventType: string, event: Record<string, unknown>): AmaSessionEventType {
  if (isAmaSessionEventType(sourceEventType)) return sourceEventType
  if (matchesRuntimeEvent(sourceEventType, 'message')) return 'transcript.message'
  if (matchesRuntimeEvent(sourceEventType, 'message.delta') || matchesRuntimeEvent(sourceEventType, 'message_update')) {
    return 'transcript.message.delta'
  }
  if (matchesRuntimeEvent(sourceEventType, 'tool.started') || matchesRuntimeEvent(sourceEventType, 'tool_execution_start')) {
    return 'tool_call.started'
  }
  if (matchesRuntimeEvent(sourceEventType, 'tool.updated') || matchesRuntimeEvent(sourceEventType, 'tool_execution_update')) {
    return 'tool_call.updated'
  }
  if (
    matchesRuntimeEvent(sourceEventType, 'tool.completed') ||
    matchesRuntimeEvent(sourceEventType, 'tool.failed') ||
    matchesRuntimeEvent(sourceEventType, 'tool_execution_end')
  ) {
    return 'tool_call.completed'
  }
  if (matchesRuntimeEvent(sourceEventType, 'usage')) return 'usage.recorded'
  if (matchesRuntimeEvent(sourceEventType, 'error')) return 'runtime.error'
  if (matchesRuntimeEvent(sourceEventType, 'output')) return 'runtime.output'
  if (sourceEventType === 'message') return 'transcript.message'
  if (sourceEventType === 'message_update') return 'transcript.message.delta'
  if (sourceEventType === 'message_end') return 'transcript.message'
  if (sourceEventType === 'tool_execution_start') return 'tool_call.started'
  if (sourceEventType === 'tool_execution_update') return 'tool_call.updated'
  if (sourceEventType === 'tool_execution_end') return 'tool_call.completed'
  if (sourceEventType === 'usage') return 'usage.recorded'
  if (sourceEventType === 'policy_denied') return 'policy.decision'
  if (sourceEventType === 'error') return 'runtime.error'
  if (sourceEventType === 'bridge_stderr') return 'runtime.output'
  if (sourceEventType === 'bridge_exit') {
    const code = event.code
    return code === 0 || code === null ? 'session.lifecycle' : 'runtime.error'
  }
  if (sourceEventType === 'queue_update' || sourceEventType === 'session_info_changed') return 'runtime.metadata'
  if (sourceEventType === 'runner_heartbeat' || sourceEventType === 'runner_status') return 'runner.metadata'
  return 'session.lifecycle'
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
): Record<string, unknown> {
  if (type === 'transcript.message' || type === 'transcript.message.delta') {
    const message = objectValue(event.message)
    const assistantEvent = objectValue(event.assistantMessageEvent)
    return {
      message: {
        id: stringField(event, 'messageId') ?? stringField(event, 'id') ?? stringField(message, 'id'),
        role: stringField(message, 'role') ?? stringField(event, 'role') ?? 'assistant',
        content: event.content ?? message.content ?? assistantEvent.text ?? assistantEvent.delta ?? '',
      },
      ...(assistantEvent.type ? { deltaType: assistantEvent.type } : {}),
      ...(assistantEvent.responseId ? { responseId: assistantEvent.responseId } : {}),
    }
  }

  if (type === 'tool_call.started' || type === 'tool_call.updated' || type === 'tool_call.completed') {
    const toolCall = objectValue(event.toolCall ?? event.call ?? event.toolExecution ?? event)
    return {
      toolCall: {
        id: stringField(toolCall, 'id') ?? stringField(toolCall, 'toolCallId') ?? stringField(event, 'toolCallId'),
        name: stringField(toolCall, 'name') ?? stringField(toolCall, 'toolName') ?? stringField(event, 'toolName'),
        input: toolCall.input ?? toolCall.args ?? event.input ?? event.args,
        output: toolCall.output ?? toolCall.result ?? toolCall.partialResult ?? event.output ?? event.result,
        error: toolCall.error ?? event.error,
        durationMs: numberField(toolCall, 'durationMs') ?? numberField(event, 'durationMs'),
      },
      status: type === 'tool_call.completed' ? (event.isError || toolCall.error ? 'error' : 'success') : 'running',
    }
  }

  if (type === 'usage.recorded') {
    return {
      provider: event.provider,
      model: event.model,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      totalTokens: event.totalTokens,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedInputTokens: event.cachedInputTokens,
      costMicros: event.costMicros,
    }
  }

  if (type === 'policy.decision') {
    return {
      allowed: false,
      category: event.category,
      ruleId: event.ruleId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      operation: event.operation,
      command: event.command,
      host: event.host,
      decision: event.decision,
    }
  }

  if (type === 'runtime.error') {
    const error = objectValue(event.error)
    return {
      message: runtimeErrorMessage(event, sourceEventType),
      code: event.code ?? error.code,
      signal: event.signal,
      details: error.details ?? event.details,
    }
  }

  if (type === 'runtime.output') {
    return {
      stream: runtimeOutputStream(event, sourceEventType),
      content: event.data ?? event.message ?? event.output ?? event.content ?? '',
    }
  }

  if (type === 'runtime.metadata' || type === 'runner.metadata') {
    const { type: _type, ...data } = event
    return { data }
  }

  return {
    stage: lifecycleStage(sourceEventType),
    status: event.status,
    reason: event.reason,
    sessionId: event.sessionId,
    willRetry: event.willRetry,
  }
}

function lifecycleStage(sourceEventType: string) {
  if (sourceEventType === 'agent_start') return 'agent_started'
  if (sourceEventType === 'turn_start') return 'turn_started'
  if (sourceEventType === 'message_start') return 'message_started'
  if (sourceEventType === 'agent_end') return 'agent_completed'
  if (sourceEventType === 'turn_end') return 'turn_completed'
  if (sourceEventType === 'bridge_exit') return 'runtime_exited'
  if (sourceEventType === 'response') return 'command_completed'
  return sourceEventType
}

function canonicalRole(type: AmaSessionEventType, event: Record<string, unknown>) {
  if (type !== 'transcript.message' && type !== 'transcript.message.delta') {
    return null
  }
  const message = objectValue(event.message)
  return stringField(message, 'role') ?? stringField(event, 'role') ?? 'assistant'
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
