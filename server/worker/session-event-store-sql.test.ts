import { describe, expect, it } from 'vitest'
import { newRelayThreadState, type RelayedRunnerEvent, serializeRow, stepRelayEvent } from './session-event-store-sql'

const scope = { organizationId: 'org-1', projectId: 'proj-1', sessionId: 'sess-1' }

function raw(id: string, sequence: number, type: string, payload: Record<string, unknown> = {}): RelayedRunnerEvent {
  return { id, sequence, type, payload, metadata: {}, createdAt: `2026-01-01T00:00:0${sequence}Z` }
}

describe('stepRelayEvent', () => {
  it('threads turn parent + message/tool correlation like the DO store', () => {
    const events = [
      raw('ts', 1, 'turn_start'),
      raw('ms', 2, 'message_start'),
      raw('mu', 3, 'message_update'),
      raw('me', 4, 'message_end'),
      raw('t1s', 5, 'tool_execution_start', { toolCall: { id: 'call-1' } }),
      raw('t1e', 6, 'tool_execution_end', { toolCall: { id: 'call-1' } }),
      raw('te', 7, 'turn_end'),
    ]
    const state = newRelayThreadState()
    const rows = events.map((event) => serializeRow(stepRelayEvent(event, scope, state)))
    const byId = new Map(rows.map((row) => [row.id, row]))

    // turn_start opens the turn; it has no enclosing turn of its own.
    expect(byId.get('ts')?.parentEventId).toBeNull()
    // Everything inside the turn nests under it.
    for (const id of ['ms', 'mu', 'me', 't1s', 't1e', 'te']) {
      expect(byId.get(id)?.parentEventId).toBe('ts')
    }
    // The message trio (no payload id) shares one threaded correlation.
    const messageCorrelation = byId.get('ms')?.correlationId
    expect(messageCorrelation).toBe('message:ms')
    expect(byId.get('mu')?.correlationId).toBe(messageCorrelation)
    expect(byId.get('me')?.correlationId).toBe(messageCorrelation)
    // The tool pair shares its explicit call id.
    expect(byId.get('t1s')?.correlationId).toBe('tool:call-1')
    expect(byId.get('t1e')?.correlationId).toBe('tool:call-1')
    // Identity is carried straight through from the runner's log.
    expect(byId.get('ms')?.sequence).toBe(2)
    expect(byId.get('ms')?.sessionId).toBe('sess-1')
  })

  it("carries the runner's own id + sequence straight onto the fanned row", () => {
    const state = newRelayThreadState()
    const row = serializeRow(stepRelayEvent(raw('evt-9', 9, 'message_start'), scope, state))
    expect(row.id).toBe('evt-9')
    expect(row.sequence).toBe(9)
  })
})
