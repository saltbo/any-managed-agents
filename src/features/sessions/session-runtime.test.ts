import {
  AMA_SESSION_EVENT_TYPES,
  type AmaSessionEventType,
  amaSessionEventCategory,
  amaSessionEventTypeFromPayload,
} from '@shared/session-events'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@/lib/api'
import { initialSessionRuntimeState, sessionRuntimeReducer } from './session-runtime'

function event(sequence: number, type: AmaSessionEventType, payload: Record<string, unknown>): SessionEvent {
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

const canonicalEventPayloads = {
  agent_start: { type: 'agent_start' },
  agent_end: { type: 'agent_end', messages: [] },
  turn_start: { type: 'turn_start' },
  turn_end: { type: 'turn_end', message: { role: 'assistant', timestamp: 2, content: 'Done' }, toolResults: [] },
  session_stop: { type: 'session_stop', reason: 'user_requested' },
  message_start: { type: 'message_start', message: { role: 'assistant', timestamp: 1, content: '' } },
  message_update: {
    type: 'message_update',
    message: { id: 'message_1', role: 'assistant', timestamp: 1, content: 'Hello' },
  },
  message_end: { type: 'message_end', message: { role: 'assistant', timestamp: 1, content: 'Hello' } },
  tool_execution_start: {
    type: 'tool_execution_start',
    toolCallId: 'tool_1',
    toolName: 'read_file',
    args: { path: 'README.md' },
  },
  tool_execution_update: {
    type: 'tool_execution_update',
    toolCallId: 'tool_1',
    toolName: 'read_file',
    args: { path: 'README.md' },
    partialResult: { content: [] },
  },
  tool_execution_end: {
    type: 'tool_execution_end',
    toolCallId: 'tool_1',
    toolName: 'read_file',
    args: { path: 'README.md' },
    result: { content: [{ type: 'text', text: 'ok' }] },
    isError: false,
  },
  'usage.recorded': { type: 'usage.recorded', promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  'policy.decision': { type: 'policy.decision', allowed: false, category: 'tool' },
  'runtime.error': { type: 'runtime.error', message: 'Runtime failed' },
  'runtime.metadata': { type: 'runtime.metadata', data: { status: 'idle' } },
  'runtime.output': { type: 'runtime.output', stream: 'stderr', content: 'Bridge failed' },
  'runner.metadata': { type: 'runner.metadata', data: { runnerId: 'runner_1' } },
} satisfies Record<AmaSessionEventType, Record<string, unknown>>

describe('sessionRuntimeReducer', () => {
  it('keeps the accepted AMA event schema aligned with reducer coverage', () => {
    expect(Object.keys(canonicalEventPayloads)).toEqual(AMA_SESSION_EVENT_TYPES)

    const state = Object.entries(canonicalEventPayloads).reduce(
      (next, [, payload], index) =>
        sessionRuntimeReducer(next, {
          type: 'event',
          event: payload,
          at: new Date((index + 1) * 1000).toISOString(),
        }),
      initialSessionRuntimeState,
    )

    expect(state.debugEvents.map((item) => item.type)).toEqual(AMA_SESSION_EVENT_TYPES)
    expect(state.messages.some((message) => message.content.includes('Hello'))).toBe(true)
    expect(state.messages.some((message) => message.content === 'Runtime failed')).toBe(true)
    expect(state.tools).toHaveLength(1)
    expect(new Set(AMA_SESSION_EVENT_TYPES.map((type) => amaSessionEventCategory(type)))).toEqual(
      new Set(['transcript', 'tool', 'lifecycle', 'usage', 'policy', 'error', 'metadata', 'output']),
    )
    for (const [type, payload] of Object.entries(canonicalEventPayloads)) {
      expect(amaSessionEventTypeFromPayload(payload)).toBe(type)
    }
    expect(amaSessionEventTypeFromPayload({ content: 'line without a type' })).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({ type: 'future_event', content: 'debug only' })).toBe('future_event')
    expect(amaSessionEventCategory('toString')).toBe('unknown')
  })

  it('ignores noncanonical events instead of rendering them as transcript messages or debug rows', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'future_event', content: 'debug only' },
      at: new Date(1000).toISOString(),
    })
    const untyped = sessionRuntimeReducer(state, {
      type: 'event',
      event: { content: 'debug only' },
      at: new Date(2000).toISOString(),
    })

    expect(untyped.messages).toHaveLength(0)
    expect(untyped.debugEvents).toHaveLength(0)
  })

  it('keeps prior tool output when updates carry empty values', () => {
    const started = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'tool_execution_start',
        toolCall: { id: 'tool_empty_values', name: 'inspect', input: { path: 'README.md' } },
      },
      at: new Date(1000).toISOString(),
    })
    const withText = sessionRuntimeReducer(started, {
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
    const withEmptyString = sessionRuntimeReducer(withText, {
      type: 'event',
      event: {
        type: 'tool_execution_update',
        toolCall: { id: 'tool_empty_values', name: 'inspect', output: '' },
      },
      at: new Date(3000).toISOString(),
    })
    const withEmptyArray = sessionRuntimeReducer(withEmptyString, {
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
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'runtime.error', data: 500 },
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('500')
    expect(state.messages[0]).toMatchObject({ content: '500', status: 'error' })
  })

  it('renders string and object runtime error diagnostics', () => {
    const stringError = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'runtime.error', error: 'direct failure' },
      at: new Date(1000).toISOString(),
    })
    const objectError = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'runtime.error', data: { reason: 'structured failure' } },
      at: new Date(2000).toISOString(),
    })

    expect(stringError.error).toBe('direct failure')
    expect(objectError.error).toBe('{"reason":"structured failure"}')
  })

  it('replays persisted runtime errors as an error run state', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'runtime.error', { type: 'runtime.error', message: 'persisted failure' })],
    })

    expect(state.runState).toBe('error')
    expect(state.messages[0]).toMatchObject({ content: 'persisted failure', status: 'error' })
  })

  it('keeps error tool calls inspectable when Pi omits an error body', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
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
    const first = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'usage.recorded', id: 'usage_1', totalTokens: 1 },
      at: new Date(1000).toISOString(),
    })
    const second = sessionRuntimeReducer(first, {
      type: 'event',
      event: { type: 'usage.recorded', id: 'usage_1', totalTokens: 1 },
      at: new Date(2000).toISOString(),
    })

    expect(second.debugEvents).toHaveLength(1)
  })

  it('omits non-transcript message content blocks', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
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
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
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
        event(3, 'turn_end', { type: 'turn_end' }),
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
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
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
        event(8, 'turn_end', { type: 'turn_end' }),
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
      event(24, 'turn_end', { type: 'turn_end' }),
    ]

    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
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

    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [...turn, ...replay, event(200, 'turn_end', { type: 'turn_end' })],
    })

    expect(state.tools).toHaveLength(1)
    expect(state.messages.map((message) => message.content)).toEqual(['run whoami', 'You are running as `root`.'])
    expect(state.debugEvents.filter((item) => item.type === 'tool_execution_start')).toHaveLength(1)
  })

  it('keeps repeated persisted commands when Runtime timestamps are new', () => {
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

    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [...firstTurn, ...secondTurn, event(24, 'turn_end', { type: 'turn_end' })],
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
    const loaded = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'message_end', messagePayload), event(2, 'turn_end', { type: 'turn_end' })],
    })
    const replayed = sessionRuntimeReducer(loaded, {
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
    const loaded = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'tool_execution_start', startPayload), event(2, 'tool_execution_end', endPayload)],
    })
    const replayedStart = sessionRuntimeReducer(loaded, {
      type: 'event',
      event: startPayload,
      at: new Date(99_000).toISOString(),
    })
    const replayedEnd = sessionRuntimeReducer(replayedStart, {
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
