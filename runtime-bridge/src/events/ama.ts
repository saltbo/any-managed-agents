import { AMA_SESSION_EVENT_TYPES, type AmaSessionEventType } from '../../../shared/session-events'
import type { AmaRuntimeEvent } from '../protocol'

const EVENT_TYPES = new Set<string>(AMA_SESSION_EVENT_TYPES)

export function assertAmaRuntimeEvent(event: AmaRuntimeEvent): AmaRuntimeEvent {
  if (!EVENT_TYPES.has(event.type)) {
    throw new Error(`Unsupported AMA runtime event type: ${event.type}`)
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error(`AMA runtime event ${event.type} must include an object payload`)
  }
  return event
}

export function runtimeEvent(type: AmaSessionEventType, payload: Record<string, unknown> = {}): AmaRuntimeEvent {
  return assertAmaRuntimeEvent({ type, payload })
}

export function textMessage(role: 'assistant' | 'user', text: string, id?: string) {
  return {
    ...(id ? { id } : {}),
    role,
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }
}

export function toolStart(toolCallId: string, toolName: string, args: Record<string, unknown> = {}) {
  return runtimeEvent('tool_execution_start', { toolCallId, toolName, args })
}

export function toolEnd(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  isError = false,
) {
  return runtimeEvent('tool_execution_end', { toolCallId, toolName, args, result, isError })
}

export function usageEvent(payload: Record<string, unknown>) {
  return runtimeEvent('usage.recorded', payload)
}

export function runtimeError(message: string, code?: string, details?: unknown) {
  return runtimeEvent('runtime.error', {
    message,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  })
}
