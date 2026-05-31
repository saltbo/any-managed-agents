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
  const runtimeType = runtimeEventType(event)
  const type = canonicalType(runtimeType, event)
  return {
    type,
    payload: canonicalPayload(type, runtimeType, event),
    visibility: 'runtime',
    role: canonicalRole(type, event),
    metadata: {
      ...metadata,
      runtimeEventType: runtimeType,
      runtimeSource: metadata.runtimeSource ?? metadata.source ?? 'runtime',
    },
  }
}

function runtimeEventType(event: Record<string, unknown>) {
  return typeof event.type === 'string' && event.type ? event.type : 'message'
}

function canonicalType(runtimeType: string, event: Record<string, unknown>): AmaSessionEventType {
  if (isAmaSessionEventType(runtimeType)) return runtimeType
  if (runtimeType === 'message') return 'transcript.message'
  if (runtimeType === 'message_update') return 'transcript.message.delta'
  if (runtimeType === 'message_end') return 'transcript.message'
  if (runtimeType === 'tool_execution_start') return 'tool_call.started'
  if (runtimeType === 'tool_execution_update') return 'tool_call.updated'
  if (runtimeType === 'tool_execution_end') return 'tool_call.completed'
  if (runtimeType === 'usage') return 'usage.recorded'
  if (runtimeType === 'policy_denied') return 'policy.decision'
  if (runtimeType === 'error') return 'runtime.error'
  if (runtimeType === 'bridge_stderr') return 'runtime.output'
  if (runtimeType === 'bridge_exit') {
    const code = event.code
    return code === 0 || code === null ? 'session.lifecycle' : 'runtime.error'
  }
  if (runtimeType === 'queue_update' || runtimeType === 'session_info_changed') return 'runtime.metadata'
  if (runtimeType === 'runner_heartbeat' || runtimeType === 'runner_status') return 'runner.metadata'
  return 'session.lifecycle'
}

function canonicalPayload(
  type: AmaSessionEventType,
  runtimeType: string,
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
    return {
      message: runtimeErrorMessage(event, runtimeType),
      code: event.code,
      signal: event.signal,
    }
  }

  if (type === 'runtime.output') {
    return {
      stream: runtimeType === 'bridge_stderr' ? 'stderr' : 'runtime',
      content: event.data ?? event.message ?? '',
    }
  }

  if (type === 'runtime.metadata' || type === 'runner.metadata') {
    const { type: _type, ...data } = event
    return { data }
  }

  return {
    stage: lifecycleStage(runtimeType),
    status: event.status,
    reason: event.reason,
    sessionId: event.sessionId,
    willRetry: event.willRetry,
  }
}

function lifecycleStage(runtimeType: string) {
  if (runtimeType === 'agent_start') return 'agent_started'
  if (runtimeType === 'turn_start') return 'turn_started'
  if (runtimeType === 'message_start') return 'message_started'
  if (runtimeType === 'agent_end') return 'agent_completed'
  if (runtimeType === 'turn_end') return 'turn_completed'
  if (runtimeType === 'bridge_exit') return 'runtime_exited'
  if (runtimeType === 'response') return 'command_completed'
  return runtimeType
}

function canonicalRole(type: AmaSessionEventType, event: Record<string, unknown>) {
  if (type !== 'transcript.message' && type !== 'transcript.message.delta') {
    return null
  }
  const message = objectValue(event.message)
  return stringField(message, 'role') ?? stringField(event, 'role') ?? 'assistant'
}

function runtimeErrorMessage(event: Record<string, unknown>, runtimeType: string) {
  if (runtimeType === 'bridge_exit') {
    return 'Runtime process exited with an error'
  }
  if (typeof event.error === 'string') {
    return event.error
  }
  const error = objectValue(event.error)
  return stringField(error, 'message') ?? stringField(event, 'message') ?? String(event.data ?? 'Runtime error')
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
