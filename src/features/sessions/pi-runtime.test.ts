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
})
