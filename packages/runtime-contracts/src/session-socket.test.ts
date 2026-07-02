import { describe, expect, it } from 'vitest'
import { sessionSocketClientMessageFrom, sessionSocketServerMessageFrom } from './session-socket'

const record = {
  id: 'evt_1',
  sessionId: 'session_1',
  sequence: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'message.completed',
  payload: { providerShape: { remains: 'opaque' } },
}

describe('sessionSocketClientMessageFrom', () => {
  it('parses prompt, steer, abort, and backfill client envelopes', () => {
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'prompt', content: 'hello' })).toEqual({
      requestId: 'msg_1',
      type: 'prompt',
      content: 'hello',
    })
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_2', type: 'steer', content: 'adjust' })).toEqual({
      requestId: 'msg_2',
      type: 'steer',
      content: 'adjust',
    })
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_3', type: 'abort', reason: 'stop' })).toEqual({
      requestId: 'msg_3',
      type: 'abort',
      reason: 'stop',
    })
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_4', type: 'abort', reason: 1 })).toEqual({
      requestId: 'msg_4',
      type: 'abort',
    })
    expect(
      sessionSocketClientMessageFrom({
        requestId: 'msg_5',
        type: 'backfill',
        cursor: 2,
        limit: 10,
        eventType: 'runtime.error',
      }),
    ).toEqual({
      type: 'backfill',
      requestId: 'msg_5',
      cursor: 2,
      limit: 10,
      eventType: 'runtime.error',
    })
    expect(sessionSocketClientMessageFrom({ type: 'backfill', requestId: 'req_1' })).toEqual({
      type: 'backfill',
      requestId: 'req_1',
    })
    expect(sessionSocketClientMessageFrom({ type: 'backfill', limit: 10 })).toEqual({
      type: 'backfill',
      limit: 10,
    })
    expect(sessionSocketClientMessageFrom({ type: 'backfill', requestId: 'req_2' })).toEqual({
      type: 'backfill',
      requestId: 'req_2',
    })
  })

  it('rejects malformed client envelopes', () => {
    expect(sessionSocketClientMessageFrom(null)).toBeNull()
    expect(sessionSocketClientMessageFrom([])).toBeNull()
    expect(sessionSocketClientMessageFrom({ id: 'msg_1', type: 'backfill' })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 1 })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'prompt' })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'steer', content: 1 })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'backfill', eventType: 'not.real' })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'backfill', cursor: -1 })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'backfill', cursor: 1.2 })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'backfill', limit: 0 })).toBeNull()
    expect(sessionSocketClientMessageFrom({ requestId: 'msg_1', type: 'unknown' })).toBeNull()
  })
})

describe('sessionSocketServerMessageFrom', () => {
  it('parses server envelopes while treating event payloads opaquely', () => {
    expect(sessionSocketServerMessageFrom({ type: 'event', record })).toEqual({ type: 'event', record })
    expect(
      sessionSocketServerMessageFrom({
        type: 'backfill',
        requestId: 'req_1',
        events: [record, { ...record, id: 1 }],
        nextCursor: 2,
        hasMore: true,
      }),
    ).toEqual({ type: 'backfill', requestId: 'req_1', events: [record], nextCursor: 2, hasMore: true })
    expect(sessionSocketServerMessageFrom({ type: 'ack', requestId: 'msg_1' })).toEqual({
      type: 'ack',
      requestId: 'msg_1',
    })
    expect(sessionSocketServerMessageFrom({ type: 'error', requestId: 'msg_1', message: 'failed' })).toEqual({
      type: 'error',
      requestId: 'msg_1',
      message: 'failed',
    })
    expect(sessionSocketServerMessageFrom({ type: 'error', message: 'failed' })).toEqual({
      type: 'error',
      message: 'failed',
    })
    expect(sessionSocketServerMessageFrom({ type: 'runner_unavailable', message: 'offline' })).toEqual({
      type: 'runner_unavailable',
      message: 'offline',
    })
  })

  it('rejects malformed server envelopes', () => {
    expect(sessionSocketServerMessageFrom(null)).toBeNull()
    expect(sessionSocketServerMessageFrom({ type: 'backfill' })).toBeNull()
    expect(sessionSocketServerMessageFrom({ type: 'backfill', events: [], hasMore: false })).toBeNull()
    expect(
      sessionSocketServerMessageFrom({
        type: 'event',
        record: { ...record, type: 1, payload: {} },
      }),
    ).toBeNull()
    expect(
      sessionSocketServerMessageFrom({
        type: 'event',
        record: { ...record, payload: [] },
      }),
    ).toBeNull()
    expect(sessionSocketServerMessageFrom({ type: 'ack', id: 'legacy' })).toBeNull()
    expect(sessionSocketServerMessageFrom({ type: 'ack', requestId: 1 })).toBeNull()
    expect(sessionSocketServerMessageFrom({ type: 'error', message: 1 })).toBeNull()
    expect(sessionSocketServerMessageFrom({ type: 'runner_unavailable', message: 1 })).toBeNull()
    expect(sessionSocketServerMessageFrom({ type: 'unknown' })).toBeNull()
  })
})
