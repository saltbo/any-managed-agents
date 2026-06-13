import { describe, expect, it } from 'vitest'
import { canonicalAmaSessionEventFromRuntimeEvent } from './session-events'

describe('[spec: sessions/events-hierarchy] canonicalAmaSessionEventFromRuntimeEvent', () => {
  it('preserves Pi agent lifecycle, message, and tool events as canonical AMA events', () => {
    expect(canonicalAmaSessionEventFromRuntimeEvent({ type: 'turn_start' })).toMatchObject({
      type: 'turn_start',
      payload: {},
      metadata: { sourceEventType: 'turn_start' },
    })

    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      }),
    ).toMatchObject({
      type: 'message_update',
      role: 'assistant',
      payload: {
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
      metadata: { sourceEventType: 'message_update' },
    })

    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        args: { command: 'npm test' },
        result: { content: [{ type: 'text', text: 'done' }], details: { exitCode: 0 } },
        isError: false,
      }),
    ).toMatchObject({
      type: 'tool_execution_end',
      payload: {
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        args: { command: 'npm test' },
        result: { content: [{ type: 'text', text: 'done' }], details: { exitCode: 0 } },
        isError: false,
      },
    })
  })

  it('keeps AMA operational events without flattening Pi events into legacy transcript/tool types', () => {
    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'usage',
        provider: 'workers-ai',
        model: '@cf/model',
        promptTokens: 3,
        completionTokens: 5,
        totalTokens: 8,
      }),
    ).toMatchObject({
      type: 'usage.recorded',
      payload: { provider: 'workers-ai', model: '@cf/model', promptTokens: 3, completionTokens: 5, totalTokens: 8 },
    })

    expect(canonicalAmaSessionEventFromRuntimeEvent({ type: 'bridge_stderr', data: 'warn' })).toMatchObject({
      type: 'runtime.output',
      payload: { stream: 'stderr', content: 'warn' },
    })

    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'copilot.error',
        error: { message: 'Runtime failed safely', code: 'runtime_exit', details: { exitCode: 2 } },
      }),
    ).toMatchObject({
      type: 'runtime.error',
      payload: { message: 'Runtime failed safely', code: 'runtime_exit', details: { exitCode: 2 } },
    })

    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'runner.session.started',
        sessionId: 'session_1',
        runtime: 'codex',
      }),
    ).toMatchObject({
      type: 'runtime.metadata',
      payload: { data: { sessionId: 'session_1', runtime: 'codex' } },
    })
  })
})
