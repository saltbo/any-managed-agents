// The session metadata stamp that routes a session's canonical event firehose to
// the per-session Session DO (SQLite hot + R2 cold). Written by the cloud-loop
// (ama) start path; read by the event-store router. Absent ⇒ events live on D1
// (pre-migration cloud sessions, self-hosted CLI sessions).
export const SESSION_DO_EVENT_STORE = 'session-do'

export const AMA_SESSION_EVENT_DEFINITIONS = {
  agent_start: { category: 'lifecycle', label: 'Agent started' },
  agent_end: { category: 'lifecycle', label: 'Agent completed' },
  turn_start: { category: 'lifecycle', label: 'Turn started' },
  turn_end: { category: 'lifecycle', label: 'Turn completed' },
  session_stop: { category: 'lifecycle', label: 'Session stopped' },
  session_checkpoint: { category: 'lifecycle', label: 'Checkpoint recorded' },
  session_resume: { category: 'lifecycle', label: 'Session resumed' },
  message_start: { category: 'transcript', label: 'Message started' },
  message_update: { category: 'transcript', label: 'Message updated' },
  message_end: { category: 'transcript', label: 'Message completed' },
  tool_execution_start: { category: 'tool', label: 'Tool execution started' },
  tool_execution_update: { category: 'tool', label: 'Tool execution updated' },
  tool_execution_end: { category: 'tool', label: 'Tool execution completed' },
  'usage.recorded': { category: 'usage', label: 'Usage recorded' },
  'policy.decision': { category: 'policy', label: 'Policy decision' },
  'permission.request': { category: 'policy', label: 'Permission requested' },
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

// Stable correlation identifier shared by related canonical events: the
// message_* trio shares `message:<id>` and tool_execution_* pairs share
// `tool:<tool call id>`, so product consumers can pair calls with results
// and reconstruct transcript threads without raw runtime events.
export function canonicalEventCorrelation(type: AmaSessionEventType, payload: Record<string, unknown>): string | null {
  const category = AMA_SESSION_EVENT_DEFINITIONS[type].category
  if (category === 'tool') {
    const toolCall = objectValue(payload.toolCall)
    const id = stringField(toolCall, 'id') ?? stringField(payload, 'toolCallId') ?? stringField(payload, 'id')
    return id ? `tool:${id}` : null
  }
  if (category === 'transcript') {
    const message = objectValue(payload.message)
    const id = stringField(payload, 'id') ?? stringField(message, 'id')
    return id ? `message:${id}` : null
  }
  return null
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

const PI_AGENT_EVENT_TYPES = new Set<string>([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
])

export function isPiAgentSessionEventType(value: string): value is AmaSessionEventType {
  return PI_AGENT_EVENT_TYPES.has(value)
}

export function canonicalAmaSessionEventFromRuntimeEvent(
  event: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): CanonicalAmaSessionEvent {
  const sourceEventType = sourceEventTypeFromRuntimeEvent(event)
  const type = canonicalType(sourceEventType)
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

function canonicalType(sourceEventType: string): AmaSessionEventType {
  if (isAmaSessionEventType(sourceEventType)) return sourceEventType
  if (matchesRuntimeEvent(sourceEventType, 'usage')) return 'usage.recorded'
  if (matchesRuntimeEvent(sourceEventType, 'error')) return 'runtime.error'
  if (matchesRuntimeEvent(sourceEventType, 'output')) return 'runtime.output'
  if (sourceEventType === 'usage') return 'usage.recorded'
  if (sourceEventType === 'policy_denied') return 'policy.decision'
  if (sourceEventType === 'error') return 'runtime.error'
  if (sourceEventType === 'bridge_stderr') return 'runtime.output'
  if (sourceEventType === 'bridge_exit') return 'runtime.error'
  if (sourceEventType === 'queue_update' || sourceEventType === 'session_info_changed') return 'runtime.metadata'
  if (sourceEventType === 'runner_heartbeat' || sourceEventType === 'runner_status') return 'runner.metadata'
  return 'runtime.metadata'
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
  if (isPiAgentSessionEventType(sourceEventType)) {
    return withoutType(event)
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
      allowed: event.allowed === true,
      category: event.category,
      ruleId: event.ruleId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      operation: event.operation,
      command: event.command,
      host: event.host,
      // MCP denials identify the connector and tool the same way sandbox
      // denials identify the command or host.
      connectorId: event.connectorId,
      toolName: event.toolName,
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
      // Normalized provider error envelope: stable category enum plus retry
      // metadata, attached by the provider adapter seam.
      ...(typeof event.category === 'string' ? { category: event.category } : {}),
      ...(typeof event.retryable === 'boolean' ? { retryable: event.retryable } : {}),
      ...(numberField(event, 'retryAfterSeconds') !== null ? { retryAfterSeconds: event.retryAfterSeconds } : {}),
      ...(typeof event.provider === 'string' ? { provider: event.provider } : {}),
      ...(typeof event.model === 'string' ? { model: event.model } : {}),
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

  return withoutType(event)
}

function canonicalRole(type: AmaSessionEventType, event: Record<string, unknown>) {
  if (type !== 'message_start' && type !== 'message_update' && type !== 'message_end') {
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

function withoutType(event: Record<string, unknown>) {
  const { type: _type, ...payload } = event
  return payload
}
