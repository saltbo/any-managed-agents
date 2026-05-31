import { describe, expect, it } from 'vitest'
import { canonicalAmaSessionEventFromRuntimeEvent } from './session-events'

describe('canonicalAmaSessionEventFromRuntimeEvent', () => {
  it('maps transcript events into canonical AMA message records', () => {
    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'message_update',
        messageId: 'msg_1',
        role: 'assistant',
        content: 'hello',
      }),
    ).toMatchObject({
      type: 'transcript.message.delta',
      role: 'assistant',
      payload: {
        message: { id: 'msg_1', role: 'assistant', content: 'hello' },
      },
      metadata: { sourceEventType: 'message_update' },
    })
  })

  it('maps tool execution events into canonical AMA tool call records', () => {
    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        input: { command: 'npm test' },
      }),
    ).toMatchObject({
      type: 'tool_call.started',
      payload: {
        toolCall: { id: 'call_1', name: 'sandbox.exec', input: { command: 'npm test' } },
        status: 'running',
      },
    })

    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'tool_execution_update',
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        partialResult: { stdout: 'running' },
      }),
    ).toMatchObject({
      type: 'tool_call.updated',
      payload: {
        toolCall: { id: 'call_1', name: 'sandbox.exec', output: { stdout: 'running' } },
        status: 'running',
      },
    })

    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        result: { stdout: 'done' },
      }),
    ).toMatchObject({
      type: 'tool_call.completed',
      payload: {
        toolCall: { id: 'call_1', name: 'sandbox.exec', output: { stdout: 'done' } },
        status: 'success',
      },
    })
  })

  it('maps usage, policy, output, error, runtime metadata, and runner metadata', () => {
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

    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'policy_denied',
        operation: 'network',
        host: 'example.com',
        decision: 'blocked',
      }),
    ).toMatchObject({
      type: 'policy.decision',
      payload: { allowed: false, operation: 'network', host: 'example.com', decision: 'blocked' },
    })

    expect(canonicalAmaSessionEventFromRuntimeEvent({ type: 'bridge_stderr', data: 'warn' })).toMatchObject({
      type: 'runtime.output',
      payload: { stream: 'stderr', content: 'warn' },
    })

    expect(canonicalAmaSessionEventFromRuntimeEvent({ type: 'bridge_exit', code: 1 })).toMatchObject({
      type: 'runtime.error',
      payload: { message: 'Runtime process exited with an error', code: 1 },
    })

    expect(canonicalAmaSessionEventFromRuntimeEvent({ type: 'bridge_exit', code: 0 })).toMatchObject({
      type: 'session.lifecycle',
      payload: { stage: 'runtime_exited' },
    })

    expect(canonicalAmaSessionEventFromRuntimeEvent({ type: 'queue_update', depth: 2 })).toMatchObject({
      type: 'runtime.metadata',
      payload: { data: { depth: 2 } },
    })

    expect(canonicalAmaSessionEventFromRuntimeEvent({ type: 'runner_heartbeat', runnerId: 'runner_1' })).toMatchObject({
      type: 'runner.metadata',
      payload: { data: { runnerId: 'runner_1' } },
    })
  })

  it('preserves already canonical event types', () => {
    expect(
      canonicalAmaSessionEventFromRuntimeEvent({
        type: 'tool_call.started',
        toolCall: { id: 'call_1', name: 'sandbox.exec' },
      }),
    ).toMatchObject({
      type: 'tool_call.started',
      payload: { toolCall: { id: 'call_1', name: 'sandbox.exec' } },
      metadata: { sourceEventType: 'tool_call.started' },
    })
  })
})
