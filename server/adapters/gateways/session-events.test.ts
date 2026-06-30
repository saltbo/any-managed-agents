import { describe, expect, it, vi } from 'vitest'
import { createSessionEventPort } from './session-events'

// The MCP event port is now a thin wrapper that builds the canonical MCP event
// and routes it through the session-event store (the DO/D1 split, redaction, and
// sequencing live in the store). These tests pin the wrapper's contract: the
// canonical shape it emits and the explicit-id overrides it threads.

const auth = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function fakeStore() {
  return {
    appendCanonicalEvent: vi.fn().mockResolvedValue('event_routed'),
    insertEvents: vi.fn(),
    queryEvents: vi.fn(),
    eventStream: vi.fn(),
    archive: vi.fn(),
  }
}

describe('createSessionEventPort (MCP)', () => {
  it('routes a runtime-visibility canonical event tagged source=mcp-client and returns the store id', async () => {
    const store = fakeStore()
    const port = createSessionEventPort(store as never)

    const eventId = await port.append({
      auth: auth as never,
      sessionId: 'sess_42',
      type: 'tool_execution_start',
      payload: { toolName: 'bash' },
    })

    expect(eventId).toBe('event_routed')
    expect(store.appendCanonicalEvent).toHaveBeenCalledWith(
      { organizationId: 'org_1', projectId: 'project_1', sessionId: 'sess_42' },
      {
        type: 'tool_execution_start',
        payload: { toolName: 'bash' },
        visibility: 'runtime',
        role: null,
        metadata: { source: 'mcp-client' },
      },
      { parentEventId: null, correlationId: null },
    )
  })

  it('threads explicit parentEventId/correlationId through as store overrides', async () => {
    const store = fakeStore()
    const port = createSessionEventPort(store as never)

    await port.append({
      auth: auth as never,
      sessionId: 'sess_1',
      type: 'tool_execution_end',
      payload: {},
      parentEventId: 'event_parent',
      correlationId: 'call_123',
    })

    expect(store.appendCanonicalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess_1' }),
      expect.objectContaining({ type: 'tool_execution_end' }),
      { parentEventId: 'event_parent', correlationId: 'call_123' },
    )
  })
})
