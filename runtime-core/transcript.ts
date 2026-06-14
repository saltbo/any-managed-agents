// Rebuilds the agent transcript from persisted (or in-memory) runtime events so
// a continuation turn resumes where the previous one left off. Host-agnostic and
// pure: both the Worker and the runner re-enter the engine from the same rebuilt
// context. Lives apart from the engine loop because it is a distinct concern with
// its own boundary (it parses persisted/queued JSON).
import type { AgentMessage } from '@earendil-works/pi-agent-core'

export function isPersistedMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object' || !('role' in value)) {
    return false
  }
  const role = (value as { role?: unknown }).role
  return role === 'user' || role === 'assistant' || role === 'toolResult'
}

// Safely resolve an event payload to an object. Persisted/queued payloads cross a
// storage boundary, so a single malformed entry must be skipped, not allowed to
// throw and abort the whole transcript rebuild.
function parseEventPayload(payload: string | Record<string, unknown>): Record<string, unknown> | null {
  if (typeof payload !== 'string') {
    return payload && typeof payload === 'object' ? payload : null
  }
  try {
    const parsed: unknown = JSON.parse(payload)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Prefers the latest agent_end snapshot, else the accumulated message_end
// messages. Malformed event payloads are skipped rather than throwing.
export function runtimeMessagesFromEvents(
  events: Array<{ type?: string; payload: string | Record<string, unknown> }>,
): AgentMessage[] {
  let latestAgentEndMessages: AgentMessage[] | null = null
  const messageEndMessages: AgentMessage[] = []
  for (const event of events) {
    const record = parseEventPayload(event.payload)
    if (!record) {
      continue
    }
    const sourceType =
      typeof event.type === 'string' ? event.type : typeof record.type === 'string' ? record.type : undefined
    if (sourceType === 'agent_end' && Array.isArray(record.messages)) {
      const messages = record.messages.filter(isPersistedMessage)
      if (messages.length > 0) {
        latestAgentEndMessages = messages
      }
      continue
    }
    if (sourceType !== 'message_end' || !isPersistedMessage(record.message)) {
      continue
    }
    messageEndMessages.push(record.message)
  }
  return latestAgentEndMessages ?? messageEndMessages
}
