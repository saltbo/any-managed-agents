import { AMA_SESSION_EVENT_TYPES, type AmaSessionEventType } from '@ama/runtime-contracts/session-events'
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
  return assertAmaRuntimeEvent({ type, payload } as AmaRuntimeEvent)
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
  return runtimeEvent('tool_execution_start', { toolCall: { id: toolCallId, name: toolName, input: args } })
}

export function toolEnd(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  isError = false,
) {
  return runtimeEvent('tool_execution_end', {
    toolCall: { id: toolCallId, name: toolName, input: args },
    result,
    isError,
    ...(isError
      ? {
          error:
            typeof result === 'string' ? { message: result } : { message: 'Tool execution failed', details: result },
        }
      : {}),
  })
}

export function usageEvent(payload: Record<string, unknown>) {
  return runtimeEvent('usage.recorded', payload)
}

// The canonical end-of-turn marker every SDK provider emits after its result
// event. The empty message/toolResults shape is the contract the protocol pins.
export function turnEnd() {
  return runtimeEvent('turn_end', {
    message: { role: 'assistant', content: [], timestamp: Date.now() },
    toolResults: [],
  })
}

export function reasoning(content: string) {
  return runtimeEvent('runtime.output', { stream: 'reasoning', content })
}

export function runtimeError(message: string, code?: string, details?: unknown) {
  return runtimeEvent('runtime.error', {
    message,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  })
}
