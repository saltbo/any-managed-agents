import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@/lib/api'
import { initialPiRuntimeState, piRuntimeReducer } from './pi-runtime'

function event(sequence: number, type: string, payload: Record<string, unknown>): SessionEvent {
  return {
    id: `event_${sequence}`,
    organizationId: 'org_1',
    projectId: 'project_1',
    sessionId: 'session_1',
    sequence,
    type,
    visibility: 'runtime',
    role: null,
    parentEventId: null,
    correlationId: null,
    payload,
    metadata: {},
    createdAt: new Date(sequence * 1000).toISOString(),
  }
}

describe('piRuntimeReducer', () => {
  it('replays persisted streaming updates into the final completed message', () => {
    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [
        event(1, 'message_update', {
          type: 'message_update',
          message: { role: 'assistant', content: [{ type: 'text', text: 'AMA' }] },
        }),
        event(2, 'message_end', {
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'AMA proxy ok' }] },
        }),
        event(3, 'agent_end', { type: 'agent_end' }),
      ],
    })

    expect(state.runState).toBe('idle')
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'AMA proxy ok',
      status: 'complete',
    })
  })
})
