// Cross-cutting session event + transcript usecases for the runtime data plane.
// Deps-first: they append canonical events and read the event stream through
// deps.sessionOrchestration, and record the prompt failure through
// deps.audit. No db handle, no adapters — they call ports only. Logic is
// verbatim from the former server/runtime/session-base helpers; only how the
// store/audit are acquired changed.

import { now } from '@server/domain/runtime/util'
import type { SessionRow } from '@shared/runtime-rows'
import { canonicalAmaSessionEventFromRuntimeEvent } from '@shared/session-events'
import type { AuditPort, AuthScope, SessionEventStore, SessionOrchestrationStore } from '../ports'
import { runtimeMessagesFromEvents } from './engine/transcript'

export async function appendRuntimeEvent(
  deps: { sessionEventStore: SessionEventStore },
  values: { auth: AuthScope; sessionId: string; event: Record<string, unknown>; metadata?: Record<string, unknown> },
) {
  const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
    values.event,
    values.metadata ?? { source: 'runtime' },
  )
  return await deps.sessionEventStore.appendCanonicalEvent(
    { organizationId: values.auth.organization.id, projectId: values.auth.project.id, sessionId: values.sessionId },
    canonicalEvent,
  )
}

export async function appendUserPromptEvent(
  deps: { sessionEventStore: SessionEventStore },
  values: { auth: AuthScope; sessionId: string; prompt: string; metadata?: Record<string, unknown> },
) {
  return appendRuntimeEvent(deps, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: {
      type: 'message_end',
      message: {
        role: 'user',
        content: [{ type: 'text', text: values.prompt }],
      },
    },
    metadata: { source: 'user-prompt', ...(values.metadata ?? {}) },
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

export async function loadRuntimeMessages(deps: { sessionEventStore: SessionEventStore }, sessionId: string) {
  return runtimeMessagesFromEvents(await deps.sessionEventStore.eventStream(sessionId))
}
