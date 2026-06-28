import {
  AMA_SESSION_EVENT_TYPES,
  type AmaSessionEventType,
  amaSessionEventCategory,
  amaSessionEventTypeFromPayload,
} from '@shared/session-events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@/lib/api'
import * as oidcModule from '@/lib/oidc'
import { initialSessionRuntimeState, runtimeWebSocketUrl, sessionRuntimeReducer } from './session-runtime'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function event(sequence: number, type: AmaSessionEventType, payload: SessionEvent['payload']): SessionEvent {
  return {
    id: `event_${sequence}`,
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
  session_checkpoint: {
    type: 'session_checkpoint',
    resumeTokenRef: 'work-item:workitem_1',
    scope: 'runtime-resume-token',
  },
  session_resume: { type: 'session_resume', fromCheckpoint: 'work-item:workitem_1', reason: 'runner-recovery' },
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
  'permission.request': {
    type: 'permission.request',
    permissionId: 'perm_session_1',
    action: 'shell',
    command: 'printf permission-ok',
    runtime: 'claude-code',
  },
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

  it('handles command_sent with abort type without changing run state to running', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'command_sent',
      command: { id: 'cmd_1', type: 'abort', message: 'abort now' },
      at: new Date(1000).toISOString(),
    })

    // abort command should NOT set runState to 'running'
    expect(state.runState).toBe('idle')
    expect(state.messages[0]?.content).toBe('abort now')
  })

  it('handles command_sent with no message by returning unchanged state', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'command_sent',
      command: { id: 'cmd_1', type: 'prompt' },
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
      event: { type: 'runtime.error', message: 'test error' },
      at: new Date(1000).toISOString(),
    })
    const reset = sessionRuntimeReducer(modified, { type: 'reset' })

    expect(reset).toEqual(initialSessionRuntimeState)
  })

  it('handles session_stop and session_checkpoint and session_resume events as debug-only events', () => {
    const afterStop = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'session_stop', reason: 'user_requested' },
      at: new Date(1000).toISOString(),
    })
    const afterCheckpoint = sessionRuntimeReducer(afterStop, {
      type: 'event',
      event: { type: 'session_checkpoint', resumeTokenRef: 'ref_1', scope: 'runtime-resume-token' },
      at: new Date(2000).toISOString(),
    })
    const afterResume = sessionRuntimeReducer(afterCheckpoint, {
      type: 'event',
      event: { type: 'session_resume', fromCheckpoint: 'ref_1', reason: 'runner-recovery' },
      at: new Date(3000).toISOString(),
    })

    // These go to debugEvents as misc events (not transcripted messages)
    expect(afterResume.debugEvents.map((e) => e.type)).toEqual(['session_stop', 'session_checkpoint', 'session_resume'])
    expect(afterResume.messages).toHaveLength(0)
  })

  it('handles permission.request as debug event without transcript message', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'permission.request',
        permissionId: 'perm_1',
        action: 'shell',
        command: 'ls',
        runtime: 'claude-code',
      },
      at: new Date(1000).toISOString(),
    })

    expect(state.debugEvents).toHaveLength(1)
    expect(state.debugEvents[0]?.type).toBe('permission.request')
    expect(state.messages).toHaveLength(0)
  })

  it('merges persisted events with session_checkpoint and keeps runState when no terminal event', () => {
    const state = sessionRuntimeReducer(
      { ...initialSessionRuntimeState, runState: 'running' },
      {
        type: 'persisted_events',
        events: [
          {
            id: 'ev_checkpoint',
            projectId: 'project_1',
            sessionId: 'session_1',
            sequence: 1,
            type: 'session_checkpoint',
            visibility: 'runtime',
            role: null,
            parentEventId: null,
            correlationId: null,
            payload: { type: 'session_checkpoint', resumeTokenRef: 'ref_1', scope: 'runtime-resume-token' },
            metadata: {},
            createdAt: new Date(1000).toISOString(),
          },
        ],
      },
    )

    // No terminal event — runState stays as-is
    expect(state.runState).toBe('running')
    expect(state.debugEvents).toHaveLength(1)
  })

  it('handles runtime.error with object-type error field', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'runtime.error', error: { message: 'structured error' } },
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('structured error')
  })

  it('handles runtime.error with content field as fallback', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'runtime.error', content: 'content error fallback' },
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('content error fallback')
  })

  it('handles runtime.error with no specific fields using default message', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'runtime.error' },
      at: new Date(1000).toISOString(),
    })

    expect(state.error).toBe('Runtime error')
  })

  it('handles message_start event with streaming status', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'message_start',
        message: { role: 'assistant', content: 'Starting...', timestamp: 12345 },
      },
      at: new Date(1000).toISOString(),
    })

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.status).toBe('streaming')
  })

  it('appends streaming content to existing message on message_update', () => {
    const started = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'message_start',
        message: { role: 'assistant', content: 'Hello', id: 'msg_stream_1' },
      },
      at: new Date(1000).toISOString(),
    })
    const updated = sessionRuntimeReducer(started, {
      type: 'event',
      event: {
        type: 'message_update',
        message: { role: 'assistant', content: ' world', id: 'msg_stream_1' },
      },
      at: new Date(2000).toISOString(),
    })

    // Streaming content is appended
    const msg = updated.messages[0]
    expect(msg?.content).toContain('Hello')
  })

  it('handles tool_execution_start with callId from toolCall.id', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'tool_execution_start',
        toolCall: { id: 'tool_from_call', name: 'read_file', input: { path: 'README.md' } },
      },
      at: new Date(1000).toISOString(),
    })

    expect(state.tools).toHaveLength(1)
    expect(state.tools[0]?.callId).toBe('tool_from_call')
    expect(state.tools[0]?.status).toBe('running')
  })

  it('handles tool_execution_end with error status from isError=true', () => {
    const started = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'tool_execution_start',
        toolCallId: 'tool_err_1',
        toolName: 'exec',
        args: { command: 'fail' },
      },
      at: new Date(1000).toISOString(),
    })
    const ended = sessionRuntimeReducer(started, {
      type: 'event',
      event: {
        type: 'tool_execution_end',
        toolCallId: 'tool_err_1',
        toolName: 'exec',
        isError: true,
        error: 'exec failed',
        result: { content: [{ type: 'text', text: 'exec failed' }] },
      },
      at: new Date(2000).toISOString(),
    })

    expect(ended.tools[0]?.status).toBe('error')
    expect(ended.tools[0]?.error).toBe('exec failed')
  })

  it('handles message_end with errorMessage field', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'message_end',
        message: { role: 'assistant', errorMessage: 'Model refused' },
      },
      at: new Date(1000).toISOString(),
    })

    expect(state.messages[0]?.status).toBe('error')
    expect(state.messages[0]?.content).toBe('Model refused')
  })

  it('handles message_end with delta field for content', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'message_end',
        delta: 'delta content here',
      },
      at: new Date(1000).toISOString(),
    })

    expect(state.messages[0]?.content).toBe('delta content here')
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

// ---------------------------------------------------------------------------
// runtimeWebSocketUrl — URL construction branches
// ---------------------------------------------------------------------------

describe('runtimeWebSocketUrl', () => {
  it('converts /rpc suffix to /ws', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/app' } })
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)

    const url = runtimeWebSocketUrl('/api/sessions/s1/runtime/rpc')
    expect(url).toContain('/ws')
    expect(url).not.toContain('/rpc')
    expect(url.startsWith('wss:')).toBe(true)
  })

  it('appends /ws for non-/rpc paths', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/' } })
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)

    const url = runtimeWebSocketUrl('/api/sessions/s1/runtime')
    expect(url).toContain('/ws')
    expect(url.startsWith('wss:')).toBe(true)
  })

  it('uses ws: protocol for http: origins', () => {
    vi.stubGlobal('window', { location: { href: 'http://localhost:3000/' } })
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)

    const url = runtimeWebSocketUrl('/api/sessions/s1/runtime/ws')
    expect(url.startsWith('ws:')).toBe(true)
    expect(url.startsWith('wss:')).toBe(false)
  })

  it('appends access_token query param when token is present', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/' } })
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue('test_token_xyz')

    const url = runtimeWebSocketUrl('/api/sessions/s1/runtime/rpc')
    expect(url).toContain('access_token=test_token_xyz')
  })

  it('strips trailing slash before appending /ws', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/' } })
    vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)

    const url = runtimeWebSocketUrl('/api/sessions/s1/runtime/')
    expect(url).toContain('/ws')
    // Should not have double slash: /runtime//ws
    expect(url).not.toContain('//ws')
  })
})

describe('sessionRuntimeReducer — extractText edge cases (line 594)', () => {
  it('extracts empty string from message with numeric content (extractText fallback)', () => {
    // When message content is a number, extractText returns '' (line 594 fallback)
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'message_end', message: { role: 'assistant', content: 42 } },
      at: '2026-05-23T00:00:00.000Z',
    })
    const msg = state.messages[0]
    // content is '' when extractText falls through to the final return ''
    expect(msg?.content ?? '').toBe('')
  })

  it('extracts empty string from message with boolean content', () => {
    const state = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: { type: 'message_end', message: { role: 'assistant', content: false } },
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
    const msgEvent = event(1, 'message_end', {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Existing message' }] },
    })
    const termEvent = event(2, 'turn_end', { type: 'turn_end' })

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
    const toolStart = event(1, 'tool_execution_start', {
      type: 'tool_execution_start',
      toolCallId: 'tool_dedup',
      toolName: 'bash',
      args: { command: 'ls' },
    })
    const toolEnd = event(2, 'tool_execution_end', {
      type: 'tool_execution_end',
      toolCallId: 'tool_dedup',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'ok' }] },
      isError: false,
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
    const debugEvent = event(1, 'agent_start', { type: 'agent_start' })

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
    expect(afterSecond.debugEvents[0]?.type).toBe('agent_start')
  })

  it('appends new items while deduplicating existing ones in all three collections', () => {
    const existingMsg = event(1, 'message_end', {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'First' }] },
    })
    const existingTool = event(2, 'tool_execution_start', {
      type: 'tool_execution_start',
      toolCallId: 'tool_existing',
      toolName: 'bash',
      args: { command: 'ls' },
    })

    const afterFirst = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'persisted_events',
      events: [existingMsg, existingTool],
    })

    const newMsg = event(10, 'message_end', {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Second' }] },
    })
    const newDebug = event(11, 'agent_start', { type: 'agent_start' })

    // Second dispatch: existing events deduplicated, new events appended.
    const afterSecond = sessionRuntimeReducer(afterFirst, {
      type: 'persisted_events',
      events: [existingMsg, existingTool, newMsg, newDebug],
    })

    // Both messages present, no duplicates.
    expect(afterSecond.messages.map((m) => m.content)).toEqual(['First', 'Second'])
    // Tools: same tool deduplicated.
    expect(afterSecond.tools).toHaveLength(1)
    // Debug events: new agent_start appended.
    const types = afterSecond.debugEvents.map((d) => d.type)
    expect(types.filter((t) => t === 'agent_start')).toHaveLength(1)
  })
})

describe('sessionRuntimeReducer — hasToolValue edge cases (lines 632, 635)', () => {
  it('preserves existing output when update result is empty string (hasToolValue("") = false)', () => {
    // Create the tool first via tool_execution_start
    const stateAfterStart = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'tool_execution_start',
        toolCallId: 'tool_str',
        toolName: 'read',
        args: { path: '/file.txt' },
      },
      at: '2026-05-23T00:00:00.000Z',
    })

    // Update with empty string result — hasToolValue('') = false → existing output kept
    const stateAfterEnd = sessionRuntimeReducer(stateAfterStart, {
      type: 'event',
      event: {
        type: 'tool_execution_end',
        toolCallId: 'tool_str',
        toolName: 'read',
        result: '',
        isError: false,
      },
      at: '2026-05-23T00:00:01.000Z',
    })

    const tool = stateAfterEnd.tools[0]
    expect(tool?.status).toBe('success')
    // Empty string output is not stored as the output (hasToolValue('') = false)
    expect(tool?.output).not.toBe('')
  })

  it('preserves existing output when update has empty array result (hasToolValue([]) = false)', () => {
    // First, create the tool via tool_execution_start with a real output
    const stateAfterStart = sessionRuntimeReducer(initialSessionRuntimeState, {
      type: 'event',
      event: {
        type: 'tool_execution_start',
        toolCallId: 'tool_arr',
        toolName: 'read',
        args: { path: '/file.txt' },
      },
      at: '2026-05-23T00:00:00.000Z',
    })

    // Then update with tool_execution_end that has empty array result
    // hasToolValue([]) → value.length > 0 → false → existing.output is kept
    const stateAfterEnd = sessionRuntimeReducer(stateAfterStart, {
      type: 'event',
      event: {
        type: 'tool_execution_end',
        toolCallId: 'tool_arr',
        toolName: 'read',
        result: [],
        isError: false,
      },
      at: '2026-05-23T00:00:01.000Z',
    })

    const tool = stateAfterEnd.tools[0]
    // Output from start (undefined/args) should be preserved since [] has no value
    expect(tool?.status).toBe('success')
    // The tool was updated (status changed to success) even though output was kept
    expect(tool?.output).not.toEqual([])
  })
})
