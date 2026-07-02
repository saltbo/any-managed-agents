import { describe, expect, it } from 'vitest'
import { type RelayedRunnerEvent, serializeRow, stepRelayEvent } from './session-event-store-sql'

const scope = { organizationId: 'org-1', projectId: 'proj-1', sessionId: 'sess-1' }

function raw(id: string, sequence: number, type: string, payload: Record<string, unknown> = {}): RelayedRunnerEvent {
  return {
    id,
    sessionId: scope.sessionId,
    sequence,
    type: type as RelayedRunnerEvent['type'],
    payload: payload as RelayedRunnerEvent['payload'],
    createdAt: `2026-01-01T00:00:0${sequence}Z`,
  }
}

describe('stepRelayEvent', () => {
  it('[spec: sessions/events-hierarchy] preserves runner event identity, order, and nested relationships', () => {
    const events = [
      raw('ts', 1, 'turn.started'),
      raw('ms', 2, 'message.started', { message: { id: 'msg_1', role: 'assistant', content: [] } }),
      raw('mu', 3, 'message.updated', { message: { id: 'msg_1', role: 'assistant', content: [] } }),
      raw('me', 4, 'message.completed', { message: { id: 'msg_1', role: 'assistant', content: [] } }),
      raw('t1s', 5, 'message.completed', {
        message: {
          id: 'msg_tool_call_1',
          role: 'assistant',
          parentMessageId: 'msg_1',
          content: [{ type: 'tool_call', toolCall: { id: 'call-1', name: 'bash', input: {} } }],
        },
      }),
      raw('t1e', 6, 'message.completed', {
        message: {
          id: 'msg_tool_result_1',
          role: 'tool',
          parentMessageId: 'msg_tool_call_1',
          parentToolCallId: 'call-1',
          content: [{ type: 'tool_result', toolCallId: 'call-1', result: { content: [] } }],
        },
      }),
      raw('te', 7, 'turn.completed'),
    ]
    const rows = events.map((event) => serializeRow(stepRelayEvent(event, scope)))
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get('ms')?.sequence).toBe(2)
    expect(byId.get('ms')?.sessionId).toBe('sess-1')
    expect(byId.get('t1s')?.payload).toMatchObject({
      message: {
        id: 'msg_tool_call_1',
        parentMessageId: 'msg_1',
        content: [{ type: 'tool_call', toolCall: { id: 'call-1', name: 'bash', input: {} } }],
      },
    })
    expect(byId.get('t1e')?.payload).toMatchObject({
      message: {
        id: 'msg_tool_result_1',
        parentMessageId: 'msg_tool_call_1',
        parentToolCallId: 'call-1',
        content: [{ type: 'tool_result', toolCallId: 'call-1', result: { content: [] } }],
      },
    })
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it("carries the runner's own id + sequence straight onto the fanned row", () => {
    const row = serializeRow(stepRelayEvent(raw('evt-9', 9, 'message.started'), scope))
    expect(row.id).toBe('evt-9')
    expect(row.sequence).toBe(9)
  })
})
