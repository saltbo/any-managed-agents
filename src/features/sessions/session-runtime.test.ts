import {
  AMA_SESSION_EVENT_TYPES,
  type AmaSessionEventType,
  amaSessionEventTypeFromPayload,
} from '@shared/session-events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventRecord } from '@/lib/amarpc'
import * as oidcModule from '@/lib/oidc'
import { initialSessionRuntimeState, sessionRuntimeReducer, sessionSocketUrl } from './session-runtime'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubWindowLocation(href: string) {
  vi.stubGlobal('window', { location: { href }, localStorage: window.localStorage })
}

function event(sequence: number, type: string, payload: Record<string, unknown>): EventRecord {
  const normalized = normalizeTestPayload(sequence, type, payload)
  return {
    id: `event_${sequence}`,
    sessionId: 'session_1',
    sequence,
    event: { type: normalized.type, payload: normalized.payload } as EventRecord['event'],
    createdAt: new Date(sequence * 1000).toISOString(),
  }
}

function normalizeTestPayload(sequence: number, type: string, payload: Record<string, unknown>) {
  if (type === 'test.tool_call') {
    const toolCall = objectValue(payload.toolCall)
    return {
      type: 'message.completed',
      payload: {
        type: 'message.completed',
        message: {
          id: `msg_${sequence}_tool_call`,
          role: 'assistant',
          content: [{ type: 'tool_call', toolCall }],
        },
      },
    }
  }
  if (type === 'test.tool_result.updated' || type === 'test.tool_result.completed') {
    const toolCall = objectValue(payload.toolCall)
    const toolCallId = stringField(toolCall, 'id') ?? `tool_${sequence}`
    const failed = Boolean(payload.error)
    return {
      type: type === 'test.tool_result.updated' ? 'message.updated' : 'message.completed',
      payload: {
        type: type === 'test.tool_result.updated' ? 'message.updated' : 'message.completed',
        message: {
          id: `msg_${sequence}_tool_result`,
          role: 'tool',
          parentToolCallId: toolCallId,
          content: [
            {
              type: 'tool_result',
              toolCallId,
              result: payload.partialResult ?? payload.result ?? { content: [] },
              ...(failed ? { error: payload.error } : {}),
            },
          ],
        },
      },
    }
  }
  return { type, payload }
}

function amaEvent(payload: Record<string, unknown>): EventRecord['event'] {
  const normalized = normalizeTestPayload(0, typeof payload.type === 'string' ? payload.type : '', payload)
  return {
    type: normalized.type as AmaSessionEventType,
    payload: normalized.payload,
  } as EventRecord['event']
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'string' ? (record[field] as string) : null
}

const canonicalEventPayloads = {
  'runtime.started': { type: 'runtime.started' },
  'runtime.completed': { type: 'runtime.completed', reason: 'done' },
  'turn.started': { type: 'turn.started', status: 'running' },
  'turn.completed': {
    type: 'turn.completed',
    status: 'completed',
    message: { id: 'msg_turn_done', role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
  },
  'message.started': { type: 'message.started', message: { id: 'msg_started', role: 'assistant', content: [] } },
  'message.updated': {
    type: 'message.updated',
    message: { id: 'message_1', role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
  },
  'message.completed': {
    type: 'message.completed',
    message: {
      id: 'msg_completed',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_call', toolCall: { id: 'tool_1', name: 'read_file', input: { path: 'README.md' } } },
      ],
    },
  },
  'usage.recorded': {
    type: 'usage.recorded',
    model: 'test-model',
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
  },
  'permission.requested': {
    type: 'permission.requested',
    permissionId: 'perm_session_1',
    command: 'printf permission-ok',
  },
  'permission.resolved': {
    type: 'permission.resolved',
    permissionId: 'perm_session_1',
    allowed: true,
  },
  'permission.denied': { type: 'permission.denied', reason: 'denied', resourceType: 'tool' },
  'runtime.error': { type: 'runtime.error', message: 'Runtime failed' },
} satisfies Record<AmaSessionEventType, Record<string, unknown>>

describe('sessionRuntimeReducer', () => {
  it('keeps the accepted AMA event schema aligned with reducer coverage', () => {
    expect(Object.keys(canonicalEventPayloads)).toEqual(AMA_SESSION_EVENT_TYPES)

    const state = Object.entries(canonicalEventPayloads).reduce(
      (next, [, payload], index) =>
        sessionRuntimeReducer(next, {
          type: 'event',
          item: amaEvent(payload),
          at: new Date((index + 1) * 1000).toISOString(),
        }),
      initialSessionRuntimeState,
    )

    expect(state.debugEvents.map((item) => item.type)).toEqual(AMA_SESSION_EVENT_TYPES)
    expect(state.messages.some((message) => message.content.includes('Hello'))).toBe(true)
    expect(state.messages.some((message) => message.content === 'Runtime failed')).toBe(true)
    expect(state.tools).toHaveLength(1)
    for (const [type, payload] of Object.entries(canonicalEventPayloads)) {
      expect(amaSessionEventTypeFromPayload(payload)).toBe(type)
    }
    expect(amaSessionEventTypeFromPayload({ content: 'line without a type' })).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({ type: 'future_event', content: 'debug only' })).toBe('future_event')
  })

  it('keeps prior tool output when updates carry empty values', () => {
    const started = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_call',
        toolCall: { id: 'tool_empty_values', name: 'inspect', input: { path: 'README.md' } },
      }),
      at: new Date(1000).toISOString(),
    })
    const withText = sessionRuntimeReducer(started, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_result.updated',
        toolCall: { id: 'tool_empty_values', name: 'inspect', input: { path: 'README.md' } },
        partialResult: { content: [{ type: 'text', text: 'first' }] },
      }),
      at: new Date(2000).toISOString(),
    })
    const withEmptyString = sessionRuntimeReducer(withText, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_result.updated',
        toolCall: { id: 'tool_empty_values', name: 'inspect', input: { path: 'README.md' } },
        partialResult: { content: [] },
      }),
      at: new Date(3000).toISOString(),
    })
    const withEmptyArray = sessionRuntimeReducer(withEmptyString, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_result.updated',
        toolCall: { id: 'tool_empty_values', name: 'inspect', input: { path: 'README.md' } },
        partialResult: { content: [] },
      }),
      at: new Date(4000).toISOString(),
    })

    expect(withEmptyArray.tools).toHaveLength(1)
    expect(withEmptyArray.tools[0]?.output).toBe('first')
  })

  it('renders runtime error diagnostics from the standard message field', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'runtime.error', message: 'model failed' }),
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('model failed')
    expect(state.messages[0]).toMatchObject({ content: 'model failed', status: 'error' })
  })

  it('replays persisted runtime errors as an error run state', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'runtime.error', { type: 'runtime.error', message: 'persisted failure' })],
    })

    expect(state.runState).toBe('error')
    expect(state.messages[0]).toMatchObject({ content: 'persisted failure', status: 'error' })
  })

  it('keeps error tool calls inspectable', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_result.completed',
        toolCall: { id: 'tool_missing_error', name: 'inspect', input: {} },
        result: { content: [] },
        error: { message: 'Tool execution failed' },
      }),
      at: new Date(1000).toISOString(),
    })

    expect(state.tools[0]).toMatchObject({
      callId: 'tool_missing_error',
      status: 'error',
      error: 'Tool execution failed',
    })
  })

  it('dedupes live debug events by id', () => {
    const first = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'usage.recorded', id: 'usage_1', model: 'test-model', totalTokens: 1 }),
      at: new Date(1000).toISOString(),
    })
    const second = sessionRuntimeReducer(first, {
      type: 'event',
      item: amaEvent({ type: 'usage.recorded', id: 'usage_1', model: 'test-model', totalTokens: 1 }),
      at: new Date(2000).toISOString(),
    })

    expect(second.debugEvents).toHaveLength(1)
  })

  it('omits non-transcript message content blocks', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'message.completed',
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'hidden' },
            { type: 'tool_call', toolCall: { id: 'call_1', name: 'bash', input: {} } },
          ],
        },
      }),
      at: new Date(1000).toISOString(),
    })

    expect(state.messages).toHaveLength(0)
  })

  it('replays persisted streaming updates into the final completed message', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [
        event(1, 'message.updated', {
          type: 'message.updated',
          message: { role: 'assistant', content: [{ type: 'text', text: 'AMA' }] },
        }),
        event(2, 'message.completed', {
          type: 'message.completed',
          message: { role: 'assistant', content: [{ type: 'text', text: 'AMA proxy ok' }] },
        }),
        event(3, 'turn.completed', { type: 'turn.completed' }),
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
        event(1, 'message.completed', {
          type: 'message.completed',
          message: { role: 'user', content: [{ type: 'text', text: 'run whoami' }] },
        }),
        event(2, 'test.tool_call', {
          type: 'test.tool_call',
          toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
        }),
        event(3, 'test.tool_result.updated', {
          type: 'test.tool_result.updated',
          toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
          partialResult: { content: [] },
        }),
        event(4, 'test.tool_result.updated', {
          type: 'test.tool_result.updated',
          toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
          partialResult: { content: [{ type: 'text', text: 'root\n' }] },
        }),
        event(5, 'test.tool_result.completed', {
          type: 'test.tool_result.completed',
          toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
          result: { content: [{ type: 'text', text: 'root\n' }] },
        }),
        event(6, 'message.completed', {
          type: 'message.completed',
          message: {
            role: 'toolResult',
            content: [
              {
                type: 'tool_result',
                toolCallId: 'functions.bash:0',
                result: { content: [{ type: 'text', text: 'root\n' }] },
              },
            ],
          },
        }),
        event(7, 'message.completed', {
          type: 'message.completed',
          message: { role: 'assistant', content: [{ type: 'text', text: 'You are running as `root`.' }] },
        }),
        event(8, 'turn.completed', { type: 'turn.completed' }),
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
      event(1, 'message.completed', {
        type: 'message.completed',
        message: { role: 'user', content: [{ type: 'text', text: 'run whoami' }] },
      }),
      event(2, 'test.tool_call', {
        type: 'test.tool_call',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
      }),
      event(3, 'test.tool_result.completed', {
        type: 'test.tool_result.completed',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
        result: { content: [{ type: 'text', text: 'root\n' }] },
      }),
      event(4, 'message.completed', {
        type: 'message.completed',
        message: { role: 'assistant', content: [{ type: 'text', text: 'You are running as `root`.' }] },
      }),
    ]
    const secondTurn = [
      event(20, 'message.completed', {
        type: 'message.completed',
        message: { role: 'user', content: [{ type: 'text', text: 'run whoami' }] },
      }),
      event(21, 'test.tool_call', {
        type: 'test.tool_call',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
      }),
      event(22, 'test.tool_result.completed', {
        type: 'test.tool_result.completed',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
        result: { content: [{ type: 'text', text: 'root\n' }] },
      }),
      event(23, 'message.completed', {
        type: 'message.completed',
        message: { role: 'assistant', content: [{ type: 'text', text: 'You are running as `root`.' }] },
      }),
      event(24, 'turn.completed', { type: 'turn.completed' }),
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
      event(1, 'message.completed', {
        type: 'message.completed',
        message: {
          role: 'user',
          timestamp: 1779675439881,
          content: [{ type: 'text', text: 'run whoami' }],
        },
      }),
      event(2, 'test.tool_call', {
        type: 'test.tool_call',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
      }),
      event(3, 'test.tool_result.completed', {
        type: 'test.tool_result.completed',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
        result: { content: [{ type: 'text', text: 'root\n' }] },
      }),
      event(4, 'message.completed', {
        type: 'message.completed',
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
      events: [...turn, ...replay, event(200, 'turn.completed', { type: 'turn.completed' })],
    })

    expect(state.tools).toHaveLength(1)
    expect(state.messages.map((message) => message.content)).toEqual(['run whoami', 'You are running as `root`.'])
    expect(
      state.debugEvents.filter((item) =>
        Array.isArray((item.payload.message as { content?: unknown } | undefined)?.content)
          ? ((item.payload.message as { content: Array<{ type?: unknown }> }).content ?? []).some(
              (block) => block.type === 'tool_call',
            )
          : false,
      ),
    ).toHaveLength(1)
  })

  it('keeps repeated persisted commands when Runtime timestamps are new', () => {
    const firstTurn = [
      event(1, 'message.completed', {
        type: 'message.completed',
        message: {
          role: 'user',
          timestamp: 1779675439881,
          content: [{ type: 'text', text: 'run whoami' }],
        },
      }),
      event(2, 'test.tool_call', {
        type: 'test.tool_call',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
      }),
      event(3, 'test.tool_result.completed', {
        type: 'test.tool_result.completed',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
        result: { content: [{ type: 'text', text: 'root\n' }] },
      }),
      event(4, 'message.completed', {
        type: 'message.completed',
        message: {
          role: 'assistant',
          timestamp: 1779675443748,
          content: [{ type: 'text', text: 'You are running as `root`.' }],
        },
      }),
    ]
    const secondTurn = [
      event(20, 'message.completed', {
        type: 'message.completed',
        message: {
          role: 'user',
          timestamp: 1779675539881,
          content: [{ type: 'text', text: 'run whoami' }],
        },
      }),
      event(21, 'test.tool_call', {
        type: 'test.tool_call',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
      }),
      event(22, 'test.tool_result.completed', {
        type: 'test.tool_result.completed',
        toolCall: { id: 'functions.bash:0', name: 'bash', input: { command: 'whoami' } },
        result: { content: [{ type: 'text', text: 'root\n' }] },
      }),
      event(23, 'message.completed', {
        type: 'message.completed',
        message: {
          role: 'assistant',
          timestamp: 1779675543748,
          content: [{ type: 'text', text: 'You are running as `root`.' }],
        },
      }),
    ]

    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [...firstTurn, ...secondTurn, event(24, 'turn.completed', { type: 'turn.completed' })],
    })

    expect(state.tools).toHaveLength(2)
    expect(state.messages.map((message) => message.content)).toEqual([
      'run whoami',
      'You are running as `root`.',
      'run whoami',
      'You are running as `root`.',
    ])
  })

  it('keeps persisted messages when a runtime reuses provider-local message ids', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [
        event(1, 'message.completed', {
          type: 'message.completed',
          message: {
            id: 'item_9',
            role: 'assistant',
            timestamp: 1782799218294,
            content: [{ type: 'text', text: 'I am waiting for a task.' }],
          },
        }),
        event(20, 'message.completed', {
          type: 'message.completed',
          message: {
            id: 'item_9',
            role: 'assistant',
            timestamp: 1782800260407,
            content: [{ type: 'text', text: 'Nothing active right now.' }],
          },
        }),
      ],
    })

    expect(state.messages.map((message) => message.id)).toEqual(['event_1', 'event_20'])
    expect(state.messages.map((message) => message.content)).toEqual([
      'I am waiting for a task.',
      'Nothing active right now.',
    ])
  })

  it('ignores live events that were already loaded from history', () => {
    const messagePayload = {
      type: 'message.completed',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'History loaded' }],
        timestamp: 1779675000000,
      },
    }
    const loaded = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'message.completed', messagePayload), event(2, 'turn.completed', { type: 'turn.completed' })],
    })
    const replayed = sessionRuntimeReducer(loaded, {
      type: 'event',
      item: amaEvent(messagePayload),
      at: new Date(99_000).toISOString(),
    })

    expect(replayed.messages).toHaveLength(1)
    expect(replayed.messages[0]?.content).toBe('History loaded')
  })

  it('handles command_sent with abort type without changing local transcript', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'command_sent',
      command: { id: 'cmd_1', type: 'abort' },
      at: new Date(1000).toISOString(),
    })

    expect(state.runState).toBe('idle')
    expect(state.messages).toHaveLength(0)
  })

  it('handles command_sent with empty content by returning unchanged state', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'command_sent',
      command: { id: 'cmd_1', type: 'prompt', content: '' },
      at: new Date(1000).toISOString(),
    })

    expect(state).toBe(initialSessionRuntimeState)
    expect(state.messages).toHaveLength(0)
  })

  it('handles connection action with explicit null error', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'connection',
      state: 'closed',
      error: null,
    })

    expect(state.connection).toBe('closed')
    expect(state.error).toBeNull()
  })

  it('handles connection action error state without explicit error keeps prior error', () => {
    const withError = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'connection',
      state: 'error',
      error: 'prior failure',
    })
    const stillError = sessionRuntimeReducer(withError, {
      type: 'connection',
      state: 'error',
    })

    expect(stillError.error).toBe('prior failure')
  })

  it('handles reset action by returning initial state', () => {
    const modified = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'runtime.error', message: 'test error' }),
      at: new Date(1000).toISOString(),
    })
    const reset = sessionRuntimeReducer(modified, { type: 'reset' })

    expect(reset).toEqual(initialSessionRuntimeState)
  })

  it('handles runtime.error events as visible error messages', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'runtime.error', message: 'runtime failed' }),
      at: new Date(1000).toISOString(),
    })

    expect(state.debugEvents.map((e) => e.type)).toEqual(['runtime.error'])
    expect(state.messages).toMatchObject([{ role: 'assistant', status: 'error', content: 'runtime failed' }])
    expect(state.runState).toBe('error')
  })

  it('handles permission.requested as debug event without transcript message', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'permission.requested',
        permissionId: 'perm_1',
        action: 'shell',
        command: 'ls',
        runtime: 'claude-code',
      }),
      at: new Date(1000).toISOString(),
    })

    expect(state.debugEvents).toHaveLength(1)
    expect(state.debugEvents[0]?.type).toBe('permission.requested')
    expect(state.messages).toHaveLength(0)
  })

  it('merges persisted runtime.error events and marks runState as error', () => {
    const state = sessionRuntimeReducer(
      { ...initialSessionRuntimeState, runState: 'running' },
      {
        type: 'persisted_events',
        events: [
          {
            id: 'ev_checkpoint',
            sessionId: 'session_1',
            sequence: 1,
            event: {
              type: 'runtime.error',
              payload: { message: 'runtime failed', code: 'runtime_failed' },
            },
            createdAt: new Date(1000).toISOString(),
          },
        ],
      },
    )

    expect(state.runState).toBe('error')
    expect(state.debugEvents).toHaveLength(1)
    expect(state.messages).toMatchObject([{ role: 'assistant', status: 'error', content: 'runtime failed' }])
  })

  it('handles runtime.error with standard message field', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'runtime.error', message: 'structured error' }),
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('structured error')
  })

  it('handles runtime.error with no specific fields using default message', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'runtime.error' }),
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('Runtime error')
  })

  it('handles message.started event with streaming status', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'message.started',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Starting...' }], timestamp: 12345 },
      }),
      at: new Date(1000).toISOString(),
    })

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.status).toBe('streaming')
  })

  it('appends streaming content to existing message on message.updated', () => {
    const started = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'message.started',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], id: 'msg_stream_1' },
      }),
      at: new Date(1000).toISOString(),
    })
    const updated = sessionRuntimeReducer(started, {
      type: 'event',
      item: amaEvent({
        type: 'message.updated',
        message: { role: 'assistant', content: [{ type: 'text', text: ' world' }], id: 'msg_stream_1' },
      }),
      at: new Date(2000).toISOString(),
    })

    // Streaming content is appended
    const msg = updated.messages[0]
    expect(msg?.content).toContain('Hello')
  })

  it('handles test.tool_call with callId from toolCall.id', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_call',
        toolCall: { id: 'tool_from_call', name: 'read_file', input: { path: 'README.md' } },
      }),
      at: new Date(1000).toISOString(),
    })

    expect(state.tools).toHaveLength(1)
    expect(state.tools[0]?.callId).toBe('tool_from_call')
    expect(state.tools[0]?.status).toBe('running')
  })

  it('handles test.tool_result.completed with error status', () => {
    const started = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_call',
        toolCall: { id: 'tool_err_1', name: 'exec', input: { command: 'fail' } },
      }),
      at: new Date(1000).toISOString(),
    })
    const ended = sessionRuntimeReducer(started, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_result.completed',
        toolCall: { id: 'tool_err_1', name: 'exec', input: { command: 'fail' } },
        error: { message: 'exec failed' },
        result: { content: [{ type: 'text', text: 'exec failed' }] },
      }),
      at: new Date(2000).toISOString(),
    })

    expect(ended.tools[0]?.status).toBe('error')
    expect(ended.tools[0]?.error).toBe('exec failed')
  })

  it('ignores live tool events that were already loaded from history', () => {
    const startPayload = {
      type: 'test.tool_call',
      id: 'tool_1',
      toolCall: { id: 'tool_1', name: 'write_file', input: { path: 'todo.md' } },
    }
    const endPayload = {
      type: 'test.tool_result.completed',
      id: 'tool_1',
      toolCall: {
        id: 'tool_1',
        name: 'write_file',
        input: { path: 'todo.md' },
      },
      result: { content: [], structuredContent: { ok: true } },
      durationMs: 12,
    }
    const loaded = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [event(1, 'test.tool_call', startPayload), event(2, 'test.tool_result.completed', endPayload)],
    })
    const replayedStart = sessionRuntimeReducer(loaded, {
      type: 'event',
      item: amaEvent(startPayload),
      at: new Date(99_000).toISOString(),
    })
    const replayedEnd = sessionRuntimeReducer(replayedStart, {
      type: 'event',
      item: amaEvent(endPayload),
      at: new Date(100_000).toISOString(),
    })

    expect(replayedEnd.tools).toHaveLength(1)
    expect(replayedEnd.tools[0]).toMatchObject({
      callId: 'tool_1',
      name: 'write_file',
      status: 'success',
      output: { content: [], structuredContent: { ok: true } },
    })
  })
})

// ---------------------------------------------------------------------------
// sessionSocketUrl — URL construction branches
// ---------------------------------------------------------------------------

describe('sessionSocketUrl', () => {
  it('keeps the advertised session socket path', () => {
    stubWindowLocation('https://example.com/app')
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)

    const url = sessionSocketUrl('/api/v1/sessions/s1/socket')
    expect(url).toContain('/api/v1/sessions/s1/socket')
    expect(url.startsWith('wss:')).toBe(true)
  })

  it('uses ws: protocol for http: origins', () => {
    stubWindowLocation('http://localhost:3000/')
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)

    const url = sessionSocketUrl('/api/v1/sessions/s1/socket')
    expect(url.startsWith('ws:')).toBe(true)
    expect(url.startsWith('wss:')).toBe(false)
  })

  it('appends access_token query param when token is present', () => {
    stubWindowLocation('https://example.com/')
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue('test_token_xyz')

    const url = sessionSocketUrl('/api/v1/sessions/s1/socket')
    expect(url).toContain('access_token=test_token_xyz')
  })
})

describe('sessionRuntimeReducer — extractText edge cases (line 594)', () => {
  it('extracts empty string from message with numeric content (extractText fallback)', () => {
    // When message content is a number, extractText returns '' (line 594 fallback)
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'message.completed', message: { role: 'assistant', content: 42 } }),
      at: '2026-05-23T00:00:00.000Z',
    })
    const msg = state.messages[0]
    // content is '' when extractText falls through to the final return ''
    expect(msg?.content ?? '').toBe('')
  })

  it('extracts empty string from message with boolean content', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({ type: 'message.completed', message: { role: 'assistant', content: false } }),
      at: '2026-05-23T00:00:00.000Z',
    })
    expect(state.messages[0]?.content ?? '').toBe('')
  })
})

describe('sessionRuntimeReducer — mergePersistedEvents filter predicates', () => {
  // These tests exercise the .filter() callbacks inside mergePersistedEvents
  // that only run when state.messages/tools/debugEvents are already non-empty.
  // Coverage target: the anonymous lambdas at lines 254-262 of session-runtime.ts.

  it('deduplicates a message that already exists in state when persisted_events is dispatched twice', () => {
    const msgEvent = event(1, 'message.completed', {
      type: 'message.completed',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Existing message' }] },
    })
    const termEvent = event(2, 'turn.completed', { type: 'turn.completed' })

    // First dispatch: state gains 1 message, 1 debugEvent
    const afterFirst = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [msgEvent, termEvent],
    })
    expect(afterFirst.messages).toHaveLength(1)

    // Second dispatch with the SAME event: the filter predicate runs against
    // state.messages (now non-empty) and deduplicates by id/sameRuntimeMessage.
    const afterSecond = sessionRuntimeReducer(afterFirst, {
      type: 'persisted_events',
      events: [msgEvent, termEvent],
    })

    // Message must not be duplicated.
    expect(afterSecond.messages).toHaveLength(1)
    expect(afterSecond.messages[0]?.content).toBe('Existing message')
  })

  it('deduplicates a tool that already exists in state when persisted_events is dispatched twice', () => {
    const toolStart = event(1, 'test.tool_call', {
      type: 'test.tool_call',
      toolCall: { id: 'tool_dedup', name: 'bash', input: { command: 'ls' } },
    })
    const toolEnd = event(2, 'test.tool_result.completed', {
      type: 'test.tool_result.completed',
      toolCall: { id: 'tool_dedup', name: 'bash', input: { command: 'ls' } },
      result: { content: [{ type: 'text', text: 'ok' }] },
    })

    const afterFirst = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [toolStart, toolEnd],
    })
    expect(afterFirst.tools).toHaveLength(1)

    // Second dispatch: state.tools.filter(...) predicate runs to avoid duplication.
    const afterSecond = sessionRuntimeReducer(afterFirst, {
      type: 'persisted_events',
      events: [toolStart, toolEnd],
    })

    expect(afterSecond.tools).toHaveLength(1)
    expect(afterSecond.tools[0]?.callId).toBe('tool_dedup')
  })

  it('deduplicates debug events that already exist in state when persisted_events is dispatched twice', () => {
    const debugEvent = event(1, 'runtime.started', { type: 'runtime.started' })

    const afterFirst = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [debugEvent],
    })
    expect(afterFirst.debugEvents).toHaveLength(1)

    // Second dispatch: state.debugEvents.filter(...) predicate runs to avoid duplication.
    const afterSecond = sessionRuntimeReducer(afterFirst, {
      type: 'persisted_events',
      events: [debugEvent],
    })

    expect(afterSecond.debugEvents).toHaveLength(1)
    expect(afterSecond.debugEvents[0]?.type).toBe('runtime.started')
  })

  it('appends new items while deduplicating existing ones in all three collections', () => {
    const existingMsg = event(1, 'message.completed', {
      type: 'message.completed',
      message: { role: 'assistant', content: [{ type: 'text', text: 'First' }] },
    })
    const existingTool = event(2, 'test.tool_call', {
      type: 'test.tool_call',
      toolCall: { id: 'tool_existing', name: 'bash', input: { command: 'ls' } },
    })

    const afterFirst = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [existingMsg, existingTool],
    })

    const newMsg = event(10, 'message.completed', {
      type: 'message.completed',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Second' }] },
    })
    const newDebug = event(11, 'runtime.started', { type: 'runtime.started' })

    // Second dispatch: existing events deduplicated, new events appended.
    const afterSecond = sessionRuntimeReducer(afterFirst, {
      type: 'persisted_events',
      events: [existingMsg, existingTool, newMsg, newDebug],
    })

    // Both messages present, no duplicates.
    expect(afterSecond.messages.map((m) => m.content)).toEqual(['First', 'Second'])
    // Tools: same tool deduplicated.
    expect(afterSecond.tools).toHaveLength(1)
    // Debug events: new runtime.started appended.
    const types = afterSecond.debugEvents.map((d) => d.type)
    expect(types.filter((t) => t === 'runtime.started')).toHaveLength(1)
  })
})

describe('sessionRuntimeReducer — hasToolValue edge cases (lines 632, 635)', () => {
  it('preserves existing output when update result is empty string (hasToolValue("") = false)', () => {
    // Create the tool first via test.tool_call
    const stateAfterStart = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_call',
        toolCall: { id: 'tool_str', name: 'read', input: { path: '/file.txt' } },
      }),
      at: '2026-05-23T00:00:00.000Z',
    })

    // Update with empty string result — hasToolValue('') = false → existing output kept
    const stateAfterEnd = sessionRuntimeReducer(stateAfterStart, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_result.completed',
        toolCall: { id: 'tool_str', name: 'read', input: { path: '/file.txt' } },
        result: { content: [] },
      }),
      at: '2026-05-23T00:00:01.000Z',
    })

    const tool = stateAfterEnd.tools[0]
    expect(tool?.status).toBe('success')
    // Empty string output is not stored as the output (hasToolValue('') = false)
    expect(tool?.output).not.toBe('')
  })

  it('preserves existing output when update has empty array result (hasToolValue([]) = false)', () => {
    // First, create the tool via test.tool_call with a real output
    const stateAfterStart = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_call',
        toolCall: { id: 'tool_arr', name: 'read', input: { path: '/file.txt' } },
      }),
      at: '2026-05-23T00:00:00.000Z',
    })

    // Then update with test.tool_result.completed that has an empty tool result.
    const stateAfterEnd = sessionRuntimeReducer(stateAfterStart, {
      type: 'event',
      item: amaEvent({
        type: 'test.tool_result.completed',
        toolCall: { id: 'tool_arr', name: 'read', input: { path: '/file.txt' } },
        result: { content: [] },
      }),
      at: '2026-05-23T00:00:01.000Z',
    })

    const tool = stateAfterEnd.tools[0]
    // Output from start (undefined/args) should be preserved since [] has no value
    expect(tool?.status).toBe('success')
    // The tool was updated (status changed to success) even though output was kept
    expect(tool?.output).not.toEqual([])
  })
})
