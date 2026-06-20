import type { SessionEventPort, SessionEventStore } from '@server/usecases/ports'

// The MCP tool path's canonical-event append. It threads its own parent/
// correlation ids and routes through the shared session-event store, so MCP
// policy checks, calls, and results land wherever the session's events live —
// the Session DO for cloud-loop (ama) sessions, D1 otherwise — and stay
// inspectable after completion. Redaction + sequencing belong to the store.
export function createSessionEventPort(store: SessionEventStore): SessionEventPort {
  return {
    async append(values) {
      return await store.appendCanonicalEvent(
        {
          organizationId: values.auth.organization.id,
          projectId: values.auth.project.id,
          sessionId: values.sessionId,
        },
        {
          type: values.type,
          payload: values.payload,
          visibility: 'runtime',
          role: null,
          metadata: { source: 'mcp-client' },
        },
        { parentEventId: values.parentEventId ?? null, correlationId: values.correlationId ?? null },
      )
    },
  }
}
