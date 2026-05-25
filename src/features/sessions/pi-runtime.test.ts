import { PI_EVENT_TYPES, type PiEventType, piEventCategory, piEventTypeFromPayload } from '@shared/pi-events'
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

const piEventPayloads = {
  message: { type: 'message', content: 'Plain runtime text' },
  response: { type: 'response', success: true, command: 'prompt' },
  agent_start: { type: 'agent_start' },
  turn_start: { type: 'turn_start' },
  message_start: { type: 'message_start', message: { role: 'assistant', timestamp: 1, content: '' } },
  message_update: {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', responseId: 'response_1', delta: 'Hello' },
  },
  message_end: { type: 'message_end', message: { role: 'assistant', timestamp: 1, content: 'Hello' } },
  tool_execution_start: {
    type: 'tool_execution_start',
    toolCall: { id: 'tool_1', name: 'read_file', input: { path: 'README.md' } },
  },
  tool_execution_update: {
    type: 'tool_execution_update',
    toolCall: { id: 'tool_1', name: 'read_file', output: { content: [] } },
  },
  tool_execution_end: {
    type: 'tool_execution_end',
    toolCall: { id: 'tool_1', name: 'read_file', output: { content: [{ type: 'text', text: 'ok' }] } },
  },
  agent_end: { type: 'agent_end' },
  turn_end: { type: 'turn_end' },
  usage: { type: 'usage', promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  error: { type: 'error', message: 'Runtime failed' },
  bridge_stderr: { type: 'bridge_stderr', message: 'Bridge failed' },
  bridge_exit: { type: 'bridge_exit', code: 1 },
} satisfies Record<PiEventType, Record<string, unknown>>

describe('piRuntimeReducer', () => {
  it('keeps the accepted Pi event schema aligned with reducer coverage', () => {
    expect(Object.keys(piEventPayloads)).toEqual(PI_EVENT_TYPES)

    const state = Object.entries(piEventPayloads).reduce(
      (next, [, payload], index) =>
        piRuntimeReducer(next, {
          type: 'event',
          event: payload,
          at: new Date((index + 1) * 1000).toISOString(),
        }),
      initialPiRuntimeState,
    )

    expect(state.debugEvents.map((item) => item.type)).toEqual(PI_EVENT_TYPES)
    expect(state.messages.some((message) => message.content === 'Plain runtime text')).toBe(true)
    expect(state.messages.some((message) => message.content === 'Hello')).toBe(true)
    expect(state.messages.some((message) => message.content === 'Runtime failed')).toBe(true)
    expect(state.messages.some((message) => message.content === 'Bridge failed')).toBe(true)
    expect(state.messages.some((message) => message.content === 'Pi runtime exited with an error')).toBe(true)
    expect(state.tools).toHaveLength(1)
    expect(new Set(PI_EVENT_TYPES.map((type) => piEventCategory(type)))).toEqual(
      new Set(['message', 'tool', 'lifecycle', 'usage', 'error', 'bridge']),
    )
    for (const [type, payload] of Object.entries(piEventPayloads)) {
      expect(piEventTypeFromPayload(payload)).toBe(type)
    }
    expect(piEventTypeFromPayload({ content: 'line without a type' })).toBe('message')
    expect(piEventTypeFromPayload({ type: 'future_event', content: 'debug only' })).toBe('future_event')
    expect(piEventCategory('toString')).toBe('unknown')
  })

  it('preserves unknown typed events for debug without rendering them as transcript messages', () => {
    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: { type: 'future_event', content: 'debug only' },
      at: new Date(1000).toISOString(),
    })

    expect(state.messages).toHaveLength(0)
    expect(state.debugEvents).toEqual([
      expect.objectContaining({
        type: 'future_event',
        payload: { type: 'future_event', content: 'debug only' },
      }),
    ])
  })

  it('keeps prior tool output when updates carry empty values', () => {
    const started = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: {
        type: 'tool_execution_start',
        toolCall: { id: 'tool_empty_values', name: 'inspect', input: { path: 'README.md' } },
      },
      at: new Date(1000).toISOString(),
    })
    const withText = piRuntimeReducer(started, {
      type: 'event',
      event: {
        type: 'tool_execution_update',
        toolCall: {
          id: 'tool_empty_values',
          name: 'inspect',
          output: { content: ['ignored', { type: 'text', text: 'first' }] },
        },
      },
      at: new Date(2000).toISOString(),
    })
    const withEmptyString = piRuntimeReducer(withText, {
      type: 'event',
      event: {
        type: 'tool_execution_update',
        toolCall: { id: 'tool_empty_values', name: 'inspect', output: '' },
      },
      at: new Date(3000).toISOString(),
    })
    const withEmptyArray = piRuntimeReducer(withEmptyString, {
      type: 'event',
      event: {
        type: 'tool_execution_update',
        toolCall: { id: 'tool_empty_values', name: 'inspect', output: [] },
      },
      at: new Date(4000).toISOString(),
    })

    expect(withEmptyArray.tools).toHaveLength(1)
    expect(withEmptyArray.tools[0]?.output).toBe('first')
  })

  it('renders scalar runtime error diagnostics', () => {
    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: { type: 'error', data: 500 },
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('500')
    expect(state.messages[0]).toMatchObject({ content: '500', status: 'error' })
  })

  it('renders string and object runtime error diagnostics', () => {
    const stringError = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: { type: 'error', error: 'direct failure' },
      at: new Date(1000).toISOString(),
    })
    const objectError = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: { type: 'error', data: { reason: 'structured failure' } },
      at: new Date(2000).toISOString(),
    })

    expect(stringError.error).toBe('direct failure')
    expect(objectError.error).toBe('{"reason":"structured failure"}')
  })

  it('replays persisted runtime errors as an error run state', () => {
    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'error', { type: 'error', message: 'persisted failure' })],
    })

    expect(state.runState).toBe('error')
    expect(state.messages[0]).toMatchObject({ content: 'persisted failure', status: 'error' })
  })

  it('keeps error tool calls inspectable when Pi omits an error body', () => {
    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: {
        type: 'tool_execution_end',
        isError: true,
        toolCall: { id: 'tool_missing_error', name: 'inspect', output: null },
      },
      at: new Date(1000).toISOString(),
    })

    expect(state.tools[0]).toMatchObject({
      callId: 'tool_missing_error',
      status: 'error',
      error: '',
    })
  })

  it('dedupes live debug events by id', () => {
    const first = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: { type: 'usage', id: 'usage_1', totalTokens: 1 },
      at: new Date(1000).toISOString(),
    })
    const second = piRuntimeReducer(first, {
      type: 'event',
      event: { type: 'usage', id: 'usage_1', totalTokens: 1 },
      at: new Date(2000).toISOString(),
    })

    expect(second.debugEvents).toHaveLength(1)
  })

  it('omits non-transcript message content blocks', () => {
    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'event',
      event: {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'hidden' },
            { type: 'toolCall', content: 'hidden' },
          ],
        },
      },
      at: new Date(1000).toISOString(),
    })

    expect(state.messages).toHaveLength(0)
  })

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

  it('collapses persisted tool updates and keeps tool results out of messages', () => {
    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [
        event(1, 'message_end', {
          type: 'message_end',
          message: { role: 'user', content: [{ type: 'text', text: 'run whoami' }] },
        }),
        event(2, 'tool_execution_start', {
          type: 'tool_execution_start',
          toolCallId: 'functions.bash:0',
          toolName: 'bash',
          args: { command: 'whoami' },
        }),
        event(3, 'tool_execution_update', {
          type: 'tool_execution_update',
          toolCallId: 'functions.bash:0',
          toolName: 'bash',
          args: { command: 'whoami' },
          partialResult: { content: [] },
        }),
        event(4, 'tool_execution_update', {
          type: 'tool_execution_update',
          toolCallId: 'functions.bash:0',
          toolName: 'bash',
          args: { command: 'whoami' },
          partialResult: { content: [{ type: 'text', text: 'root\n' }] },
        }),
        event(5, 'tool_execution_end', {
          type: 'tool_execution_end',
          toolCallId: 'functions.bash:0',
          toolName: 'bash',
          result: { content: [{ type: 'text', text: 'root\n' }] },
          isError: false,
        }),
        event(6, 'message_end', {
          type: 'message_end',
          message: {
            role: 'toolResult',
            toolCallId: 'functions.bash:0',
            toolName: 'bash',
            content: [{ type: 'text', text: 'root\n' }],
            isError: false,
          },
        }),
        event(7, 'message_end', {
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'You are running as `root`.' }] },
        }),
        event(8, 'agent_end', { type: 'agent_end' }),
      ],
    })

    expect(state.runState).toBe('idle')
    expect(state.tools).toHaveLength(1)
    expect(state.tools[0]).toMatchObject({
      callId: 'functions.bash:0',
      name: 'bash',
      status: 'success',
      input: { command: 'whoami' },
      output: 'root\n',
    })
    expect(state.messages.map((message) => message.content)).toEqual(['run whoami', 'You are running as `root`.'])
  })

  it('keeps repeated tool call ids in separate turns', () => {
    const firstTurn = [
      event(1, 'message_end', {
        type: 'message_end',
        message: { role: 'user', content: [{ type: 'text', text: 'run whoami' }] },
      }),
      event(2, 'tool_execution_start', {
        type: 'tool_execution_start',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        args: { command: 'whoami' },
      }),
      event(3, 'tool_execution_end', {
        type: 'tool_execution_end',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'root\n' }] },
        isError: false,
      }),
      event(4, 'message_end', {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'You are running as `root`.' }] },
      }),
    ]
    const secondTurn = [
      event(20, 'message_end', {
        type: 'message_end',
        message: { role: 'user', content: [{ type: 'text', text: 'run whoami' }] },
      }),
      event(21, 'tool_execution_start', {
        type: 'tool_execution_start',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        args: { command: 'whoami' },
      }),
      event(22, 'tool_execution_end', {
        type: 'tool_execution_end',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'root\n' }] },
        isError: false,
      }),
      event(23, 'message_end', {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'You are running as `root`.' }] },
      }),
      event(24, 'agent_end', { type: 'agent_end' }),
    ]

    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [...firstTurn, ...secondTurn],
    })

    expect(state.tools).toHaveLength(2)
    expect(state.messages.map((message) => message.content)).toEqual([
      'run whoami',
      'You are running as `root`.',
      'run whoami',
      'You are running as `root`.',
    ])
  })

  it('dedupes replayed persisted Pi events with the same runtime timestamps', () => {
    const turn = [
      event(1, 'message_end', {
        type: 'message_end',
        message: {
          role: 'user',
          timestamp: 1779675439881,
          content: [{ type: 'text', text: 'run whoami' }],
        },
      }),
      event(2, 'tool_execution_start', {
        type: 'tool_execution_start',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        args: { command: 'whoami' },
      }),
      event(3, 'tool_execution_end', {
        type: 'tool_execution_end',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'root\n' }] },
        isError: false,
      }),
      event(4, 'message_end', {
        type: 'message_end',
        message: {
          role: 'assistant',
          timestamp: 1779675443748,
          content: [{ type: 'text', text: 'You are running as `root`.' }],
        },
      }),
    ]
    const replay = turn.map((item, index) => ({
      ...item,
      id: `event_replay_${index + 1}`,
      sequence: item.sequence + 100,
      createdAt: new Date((item.sequence + 100) * 1000).toISOString(),
    }))

    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [...turn, ...replay, event(200, 'agent_end', { type: 'agent_end' })],
    })

    expect(state.tools).toHaveLength(1)
    expect(state.messages.map((message) => message.content)).toEqual(['run whoami', 'You are running as `root`.'])
    expect(state.debugEvents.filter((item) => item.type === 'tool_execution_start')).toHaveLength(1)
  })

  it('keeps repeated persisted commands when Pi runtime timestamps are new', () => {
    const firstTurn = [
      event(1, 'message_end', {
        type: 'message_end',
        message: {
          role: 'user',
          timestamp: 1779675439881,
          content: [{ type: 'text', text: 'run whoami' }],
        },
      }),
      event(2, 'tool_execution_start', {
        type: 'tool_execution_start',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        args: { command: 'whoami' },
      }),
      event(3, 'tool_execution_end', {
        type: 'tool_execution_end',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'root\n' }] },
        isError: false,
      }),
      event(4, 'message_end', {
        type: 'message_end',
        message: {
          role: 'assistant',
          timestamp: 1779675443748,
          content: [{ type: 'text', text: 'You are running as `root`.' }],
        },
      }),
    ]
    const secondTurn = [
      event(20, 'message_end', {
        type: 'message_end',
        message: {
          role: 'user',
          timestamp: 1779675539881,
          content: [{ type: 'text', text: 'run whoami' }],
        },
      }),
      event(21, 'tool_execution_start', {
        type: 'tool_execution_start',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        args: { command: 'whoami' },
      }),
      event(22, 'tool_execution_end', {
        type: 'tool_execution_end',
        toolCallId: 'functions.bash:0',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'root\n' }] },
        isError: false,
      }),
      event(23, 'message_end', {
        type: 'message_end',
        message: {
          role: 'assistant',
          timestamp: 1779675543748,
          content: [{ type: 'text', text: 'You are running as `root`.' }],
        },
      }),
    ]

    const state = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [...firstTurn, ...secondTurn, event(24, 'agent_end', { type: 'agent_end' })],
    })

    expect(state.tools).toHaveLength(2)
    expect(state.messages.map((message) => message.content)).toEqual([
      'run whoami',
      'You are running as `root`.',
      'run whoami',
      'You are running as `root`.',
    ])
  })

  it('ignores live events that were already loaded from history', () => {
    const messagePayload = {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'History loaded' }],
        timestamp: 1779675000000,
      },
    }
    const loaded = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'message_end', messagePayload), event(2, 'agent_end', { type: 'agent_end' })],
    })
    const replayed = piRuntimeReducer(loaded, {
      type: 'event',
      event: messagePayload,
      at: new Date(99_000).toISOString(),
    })

    expect(replayed.messages).toHaveLength(1)
    expect(replayed.messages[0]?.content).toBe('History loaded')
  })

  it('ignores live tool events that were already loaded from history', () => {
    const startPayload = {
      type: 'tool_execution_start',
      id: 'tool_1',
      toolCall: { id: 'tool_1', name: 'write_file', input: { path: 'todo.md' } },
    }
    const endPayload = {
      type: 'tool_execution_end',
      id: 'tool_1',
      toolCall: {
        id: 'tool_1',
        name: 'write_file',
        input: { path: 'todo.md' },
        output: { ok: true },
        durationMs: 12,
      },
    }
    const loaded = piRuntimeReducer(initialPiRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'tool_execution_start', startPayload), event(2, 'tool_execution_end', endPayload)],
    })
    const replayedStart = piRuntimeReducer(loaded, {
      type: 'event',
      event: startPayload,
      at: new Date(99_000).toISOString(),
    })
    const replayedEnd = piRuntimeReducer(replayedStart, {
      type: 'event',
      event: endPayload,
      at: new Date(100_000).toISOString(),
    })

    expect(replayedEnd.tools).toHaveLength(1)
    expect(replayedEnd.tools[0]).toMatchObject({
      callId: 'tool_1',
      name: 'write_file',
      status: 'success',
      output: { ok: true },
    })
  })
})
