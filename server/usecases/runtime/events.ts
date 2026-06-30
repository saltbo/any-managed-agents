// Cross-cutting session event + transcript usecases for the runtime data plane.
// Deps-first: they append AMA protocol events and read the event stream through
// ports. No db handle, no adapters.

import { now } from '@server/domain/runtime/util'
import type { SessionRow } from '@shared/runtime-rows'
import {
  type AmaEvent,
  amaEventFromRuntimeEvent,
  isAmaSessionEventType,
  normalizeAmaEvent,
} from '@shared/session-events'
import type { AuditPort, AuthScope, EventStore, SessionOrchestrationStore } from '../ports'
import { runtimeMessagesFromEvents } from './engine/transcript'

export async function appendAmaEvent(
  deps: { sessionEventStore: EventStore },
  values: { auth: AuthScope; sessionId: string; event: AmaEvent },
) {
  return await deps.sessionEventStore.appendEvent(
    { organizationId: values.auth.organization.id, projectId: values.auth.project.id, sessionId: values.sessionId },
    values.event,
  )
}

export async function appendRuntimeEvent(
  deps: { sessionEventStore: EventStore },
  values: { auth: AuthScope; sessionId: string; event: Record<string, unknown>; metadata?: Record<string, unknown> },
) {
  if (typeof values.event.type === 'string' && isAmaSessionEventType(values.event.type) && 'payload' in values.event) {
    return appendAmaEvent(deps, {
      auth: values.auth,
      sessionId: values.sessionId,
      event: normalizeAmaEvent(values.event as AmaEvent),
    })
  }
  return appendAmaEvent(deps, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: amaEventFromRuntimeEvent(values.event, values.metadata ?? { source: 'runtime' }),
  })
}

export async function appendUserPromptEvent(
  deps: { sessionEventStore: EventStore },
  values: { auth: AuthScope; sessionId: string; prompt: string; metadata?: Record<string, unknown> },
) {
  return appendAmaEvent(deps, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: {
      type: 'message.completed',
      payload: {
        message: {
          role: 'user',
          content: [{ type: 'text', text: values.prompt }],
        },
      },
      metadata: { source: 'user-prompt', ...(values.metadata ?? {}) },
    },
  })
}

export async function markPromptFailed(
  deps: { sessionOrchestration: SessionOrchestrationStore; audit: AuditPort },
  auth: AuthScope,
  session: SessionRow,
  message: string,
  status?: number,
) {
  const failedAt = now()
  await deps.sessionOrchestration.updateSessionWhenState(auth.project.id, session.id, 'running', {
    state: 'error',
    stateReason: message,
    updatedAt: failedAt,
  })
  await deps.audit.record(auth, {
    action: 'session.prompt',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'failure',
    sessionId: session.id,
    metadata: { message, ...(status ? { status } : {}) },
  })
}

export async function loadRuntimeMessages(deps: { sessionEventStore: EventStore }, sessionId: string) {
  return runtimeMessagesFromEvents(await deps.sessionEventStore.eventStream(sessionId))
}
