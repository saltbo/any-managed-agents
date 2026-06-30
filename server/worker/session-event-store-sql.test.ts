import { describe, expect, it } from 'vitest'
import { type RelayedRunnerEvent, serializeRow, stepRelayEvent } from './session-event-store-sql'

const scope = { organizationId: 'org-1', projectId: 'proj-1', sessionId: 'sess-1' }

function raw(id: string, sequence: number, type: string, payload: Record<string, unknown> = {}): RelayedRunnerEvent {
  return {
    id,
    sequence,
    event: { type: type as RelayedRunnerEvent['event']['type'], payload, metadata: {} } as RelayedRunnerEvent['event'],
    createdAt: `2026-01-01T00:00:0${sequence}Z`,
  }
}

describe('stepRelayEvent', () => {
  it('preserves runner event identity and payload without adding transport-only threading fields', () => {
    const events = [
      raw('ts', 1, 'turn.started'),
      raw('ms', 2, 'message.started', { message: { role: 'assistant', content: [] } }),
      raw('mu', 3, 'message.updated', { message: { id: 'msg_1', role: 'assistant', content: [] } }),
      raw('me', 4, 'message.completed', { message: { id: 'msg_1', role: 'assistant', content: [] } }),
      raw('t1s', 5, 'tool_call.started', { toolCall: { id: 'call-1', name: 'bash', input: {} } }),
      raw('t1e', 6, 'tool_call.completed', { toolCall: { id: 'call-1', name: 'bash', input: {} } }),
      raw('te', 7, 'turn.completed'),
    ]
    const rows = events.map((event) => serializeRow(stepRelayEvent(event, scope)))
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get('ms')?.sequence).toBe(2)
    expect(byId.get('ms')?.sessionId).toBe('sess-1')
    expect(byId.get('t1s')?.event.payload).toEqual({ toolCall: { id: 'call-1', name: 'bash', input: {} } })
  })

  it("carries the runner's own id + sequence straight onto the fanned row", () => {
    const row = serializeRow(stepRelayEvent(raw('evt-9', 9, 'message.started'), scope))
    expect(row.id).toBe('evt-9')
    expect(row.sequence).toBe(9)
  })
})
