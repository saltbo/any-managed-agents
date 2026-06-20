import { describe, expect, it } from 'vitest'
import { queryRelayedEvents, type RelayedRunnerEvent } from './session-event-store-sql'

const scope = { organizationId: 'org-1', projectId: 'proj-1', sessionId: 'sess-1' }

function raw(id: string, sequence: number, type: string, payload: Record<string, unknown> = {}): RelayedRunnerEvent {
  return { id, sequence, type, payload, metadata: {}, createdAt: `2026-01-01T00:00:0${sequence}Z` }
}

describe('queryRelayedEvents (relay read = second implementation of the store query)', () => {
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
    const page = queryRelayedEvents(events, scope, { order: 'asc', limit: 50 })
    const byId = new Map(page.rows.map((row) => [row.id, row]))

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

  it('applies the same cursor/order/limit pagination as queryEventsFromSql', () => {
    const events = Array.from({ length: 5 }, (_, i) => raw(`e${i + 1}`, i + 1, 'runtime.output'))

    const firstAsc = queryRelayedEvents(events, scope, { order: 'asc', limit: 2 })
    expect(firstAsc.rows.map((r) => r.sequence)).toEqual([1, 2])
    expect(firstAsc.hasMore).toBe(true)

    const afterCursor = queryRelayedEvents(events, scope, { order: 'asc', limit: 2, cursor: 2 })
    expect(afterCursor.rows.map((r) => r.sequence)).toEqual([3, 4])
    expect(afterCursor.hasMore).toBe(true)

    const desc = queryRelayedEvents(events, scope, { order: 'desc', limit: 2 })
    expect(desc.rows.map((r) => r.sequence)).toEqual([5, 4])
  })
})
