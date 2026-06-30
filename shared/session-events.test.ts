import { describe, expect, it } from 'vitest'
import {
  AMA_SESSION_EVENT_CATEGORIES,
  AMA_SESSION_EVENT_TYPES,
  amaEventFromRuntimeEvent,
  amaSessionEventCategory,
  amaSessionEventLabel,
  amaSessionEventTypeFromPayload,
  isAmaSessionEventType,
  isPiAgentSessionEventType,
} from './session-events'

describe('[spec: sessions/events-hierarchy] amaEventFromRuntimeEvent', () => {
  it('preserves Pi agent lifecycle, message, and tool events as canonical AMA events', () => {
    expect(amaEventFromRuntimeEvent({ type: 'turn_start' })).toMatchObject({
      type: 'turn_start',
      payload: {},
      metadata: { sourceEventType: 'turn_start' },
    })

    expect(
      amaEventFromRuntimeEvent({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      }),
    ).toMatchObject({
      type: 'message_update',
      payload: {
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
      metadata: { sourceEventType: 'message_update' },
    })

    expect(
      amaEventFromRuntimeEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: { command: 'npm test' },
        result: { content: [{ type: 'text', text: 'done' }], details: { exitCode: 0 } },
        isError: false,
      }),
    ).toMatchObject({
      type: 'tool_execution_end',
      payload: {
        toolCall: { id: 'call_1', name: 'bash', input: { command: 'npm test' } },
        result: { content: [{ type: 'text', text: 'done' }], details: { exitCode: 0 } },
        isError: false,
      },
    })
  })

  it('keeps AMA operational events without flattening Pi events into legacy transcript/tool types', () => {
    expect(
      amaEventFromRuntimeEvent({
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

    expect(amaEventFromRuntimeEvent({ type: 'bridge_stderr', data: 'warn' })).toMatchObject({
      type: 'runtime.output',
      payload: { stream: 'stderr', content: 'warn' },
    })

    expect(
      amaEventFromRuntimeEvent({
        type: 'copilot.error',
        error: { message: 'Runtime failed safely', code: 'runtime_exit', details: { exitCode: 2 } },
      }),
    ).toMatchObject({
      type: 'runtime.error',
      payload: { message: 'Runtime failed safely', code: 'runtime_exit', details: { exitCode: 2 } },
    })

    expect(amaEventFromRuntimeEvent({ type: 'queue_update', queueDepth: 1 })).toMatchObject({
      type: 'runtime.metadata',
      payload: { data: { queueDepth: 1 } },
    })
  })
})

// ── isAmaSessionEventType ─────────────────────────────────────────────────────

describe('isAmaSessionEventType', () => {
  it('returns true for every key in AMA_SESSION_EVENT_DEFINITIONS', () => {
    for (const type of AMA_SESSION_EVENT_TYPES) {
      expect(isAmaSessionEventType(type)).toBe(true)
    }
  })

  it('returns false for an unknown string', () => {
    expect(isAmaSessionEventType('not_a_real_type')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isAmaSessionEventType('')).toBe(false)
  })
})

// ── isPiAgentSessionEventType ─────────────────────────────────────────────────

describe('isPiAgentSessionEventType', () => {
  it('returns true for Pi agent event types', () => {
    expect(isPiAgentSessionEventType('agent_start')).toBe(true)
    expect(isPiAgentSessionEventType('tool_execution_end')).toBe(true)
    expect(isPiAgentSessionEventType('message_update')).toBe(true)
  })

  it('returns false for AMA operational event types not in the Pi set', () => {
    expect(isPiAgentSessionEventType('usage.recorded')).toBe(false)
    expect(isPiAgentSessionEventType('runtime.error')).toBe(false)
    expect(isPiAgentSessionEventType('policy.decision')).toBe(false)
  })

  it('returns false for unknown strings', () => {
    expect(isPiAgentSessionEventType('unknown_event')).toBe(false)
  })
})

// ── amaSessionEventCategory ───────────────────────────────────────────────────

describe('amaSessionEventCategory', () => {
  it('returns the correct category for known event types', () => {
    expect(amaSessionEventCategory('agent_start')).toBe('lifecycle')
    expect(amaSessionEventCategory('message_start')).toBe('transcript')
    expect(amaSessionEventCategory('tool_execution_start')).toBe('tool')
    expect(amaSessionEventCategory('usage.recorded')).toBe('usage')
    expect(amaSessionEventCategory('policy.decision')).toBe('policy')
    expect(amaSessionEventCategory('runtime.error')).toBe('error')
    expect(amaSessionEventCategory('runtime.metadata')).toBe('metadata')
    expect(amaSessionEventCategory('runtime.output')).toBe('output')
  })

  it('returns unknown for an unrecognized event type', () => {
    expect(amaSessionEventCategory('not_real')).toBe('unknown')
  })

  it('covers every category in AMA_SESSION_EVENT_CATEGORIES', () => {
    const covered = new Set(AMA_SESSION_EVENT_TYPES.map((t) => amaSessionEventCategory(t)))
    for (const cat of AMA_SESSION_EVENT_CATEGORIES) {
      expect(covered.has(cat)).toBe(true)
    }
  })
})

// ── amaSessionEventLabel ──────────────────────────────────────────────────────

describe('amaSessionEventLabel', () => {
  it('returns the human-readable label for known event types', () => {
    expect(amaSessionEventLabel('agent_start')).toBe('Agent started')
    expect(amaSessionEventLabel('session_stop')).toBe('Session stopped')
    expect(amaSessionEventLabel('runtime.error')).toBe('Runtime error')
  })

  it('returns the raw type string for unknown event types', () => {
    expect(amaSessionEventLabel('completely_unknown')).toBe('completely_unknown')
  })
})

// ── amaSessionEventTypeFromPayload ────────────────────────────────────────────

describe('amaSessionEventTypeFromPayload', () => {
  it('returns the type field when it is a non-empty string', () => {
    expect(amaSessionEventTypeFromPayload({ type: 'agent_start' })).toBe('agent_start')
  })

  it('returns unknown when type is missing', () => {
    expect(amaSessionEventTypeFromPayload({})).toBe('unknown')
  })

  it('returns unknown when type is an empty string', () => {
    expect(amaSessionEventTypeFromPayload({ type: '' })).toBe('unknown')
  })

  it('returns unknown when type is not a string', () => {
    expect(amaSessionEventTypeFromPayload({ type: 42 })).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({ type: null })).toBe('unknown')
  })
})

// ── amaEventFromRuntimeEvent — additional branches ────────────

describe('amaEventFromRuntimeEvent — policy.decision branch', () => {
  it('maps policy_denied source event to policy.decision type', () => {
    expect(
      amaEventFromRuntimeEvent({
        type: 'policy_denied',
        allowed: false,
        category: 'sandbox',
        command: 'rm -rf /',
      }),
    ).toMatchObject({
      type: 'policy.decision',
      payload: { allowed: false, category: 'sandbox', command: 'rm -rf /' },
    })
  })

  it('sets allowed to false when event.allowed is not strictly true', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'policy_denied',
      allowed: 'yes',
    })
    expect(result.type).toBe('policy.decision')
    expect((result.payload as Record<string, unknown>).allowed).toBe(false)
  })
})

describe('amaEventFromRuntimeEvent — runtime.error additional branches', () => {
  it('uses bridge_exit message for bridge_exit source events', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'bridge_exit',
      signal: 'SIGKILL',
    })
    expect(result.type).toBe('runtime.error')
    expect((result.payload as Record<string, unknown>).message).toBe(
      'Runtime process exited with an error',
    )
  })

  it('uses event.error string directly when error is a string', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'error',
      error: 'plain string error',
    })
    expect(result.type).toBe('runtime.error')
    expect((result.payload as Record<string, unknown>).message).toBe('plain string error')
  })

  it('falls back to event.message when error object has no message field', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'error',
      error: { code: 'E_FAIL' },
      message: 'top-level message',
    })
    expect((result.payload as Record<string, unknown>).message).toBe('top-level message')
  })

  it('falls back to event.data string when no message is available', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'error',
      error: {},
      data: 'some data',
    })
    expect((result.payload as Record<string, unknown>).message).toBe('some data')
  })

  it('falls back to Runtime error when no error message source exists', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'error',
    })
    expect((result.payload as Record<string, unknown>).message).toBe('Runtime error')
  })

  it('includes optional fields when present on runtime.error event', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'error',
      error: { message: 'fail', code: 'E1', details: { x: 1 } },
      category: 'rate_limit',
      retryable: true,
      retryAfterSeconds: 30,
      provider: 'anthropic',
      model: 'claude-3',
    })
    const payload = result.payload as Record<string, unknown>
    expect(payload.category).toBe('rate_limit')
    expect(payload.retryable).toBe(true)
    expect(payload.retryAfterSeconds).toBe(30)
    expect(payload.provider).toBe('anthropic')
    expect(payload.model).toBe('claude-3')
  })

  it('omits optional fields when not present on runtime.error event', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'error',
      error: { message: 'fail' },
    })
    const payload = result.payload as Record<string, unknown>
    expect(payload).not.toHaveProperty('category')
    expect(payload).not.toHaveProperty('retryable')
    expect(payload).not.toHaveProperty('retryAfterSeconds')
    expect(payload).not.toHaveProperty('provider')
    expect(payload).not.toHaveProperty('model')
  })
})

describe('amaEventFromRuntimeEvent — runtime.output stream branches', () => {
  it('returns stdout stream when event.stream is stdout', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'runner.output',
      stream: 'stdout',
      data: 'hello',
    })
    expect(result.type).toBe('runtime.output')
    expect((result.payload as Record<string, unknown>).stream).toBe('stdout')
  })

  it('returns stderr stream when event.stream is stderr (non-bridge_stderr source)', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'runner.output',
      stream: 'stderr',
      data: 'err line',
    })
    expect((result.payload as Record<string, unknown>).stream).toBe('stderr')
  })

  it('returns runtime stream when event.stream is an unrecognized value', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'runner.output',
      stream: 'unknown_stream',
      data: 'out',
    })
    expect((result.payload as Record<string, unknown>).stream).toBe('runtime')
  })

  it('returns runtime stream when event.stream is absent', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'runner.output',
      data: 'out',
    })
    expect((result.payload as Record<string, unknown>).stream).toBe('runtime')
  })

  it('prefers event.data for content, then event.message, then event.output, then event.content', () => {
    expect(
      (amaEventFromRuntimeEvent({ type: 'runner.output', data: 'd', message: 'm', output: 'o', content: 'c' }).payload as Record<string, unknown>).content,
    ).toBe('d')
    expect(
      (amaEventFromRuntimeEvent({ type: 'runner.output', message: 'm', output: 'o', content: 'c' }).payload as Record<string, unknown>).content,
    ).toBe('m')
    expect(
      (amaEventFromRuntimeEvent({ type: 'runner.output', output: 'o', content: 'c' }).payload as Record<string, unknown>).content,
    ).toBe('o')
    expect(
      (amaEventFromRuntimeEvent({ type: 'runner.output', content: 'c' }).payload as Record<string, unknown>).content,
    ).toBe('c')
    expect(
      (amaEventFromRuntimeEvent({ type: 'runner.output' }).payload as Record<string, unknown>).content,
    ).toBe('')
  })
})

describe('amaEventFromRuntimeEvent — runner.metadata branch', () => {
  it('maps runner_heartbeat to runner.metadata', () => {
    const result = amaEventFromRuntimeEvent({ type: 'runner_heartbeat', runnerId: 'r1' })
    expect(result.type).toBe('runner.metadata')
    expect((result.payload as Record<string, unknown>).data).toMatchObject({ runnerId: 'r1' })
  })

  it('maps runner_status to runner.metadata', () => {
    const result = amaEventFromRuntimeEvent({ type: 'runner_status', status: 'ready' })
    expect(result.type).toBe('runner.metadata')
  })
})

describe('amaEventFromRuntimeEvent — message payload role branches', () => {
  it('keeps role inside event.message for message events', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'message_start',
      message: { role: 'user', content: [] },
    })
    expect(result.payload).toMatchObject({ message: { role: 'user' } })
  })

  it('uses event.role when message.role is absent for message events', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'message_end',
      role: 'assistant',
    })
    expect(result.payload).toMatchObject({ message: { role: 'assistant' } })
  })

  it('defaults message role to assistant when neither message.role nor event.role is present', () => {
    const result = amaEventFromRuntimeEvent({ type: 'message_start' })
    expect(result.payload).toMatchObject({ message: { role: 'assistant' } })
  })

  it('does not add an outer role for non-message event types', () => {
    expect(amaEventFromRuntimeEvent({ type: 'agent_start' })).not.toHaveProperty('role')
    expect(amaEventFromRuntimeEvent({ type: 'turn_end' })).not.toHaveProperty('role')
    expect(amaEventFromRuntimeEvent({ type: 'usage.recorded' })).not.toHaveProperty('role')
  })
})

describe('amaEventFromRuntimeEvent — canonicalType catchall and source branches', () => {
  it('maps no-type event to runtime.metadata (message fallback → metadata default)', () => {
    // event without type → sourceEventType = 'message' → not a pi type, not in map → runtime.metadata
    const result = amaEventFromRuntimeEvent({ data: 'x' })
    expect(result.type).toBe('runtime.metadata')
  })

  it('maps queue_update to runtime.metadata', () => {
    const result = amaEventFromRuntimeEvent({ type: 'queue_update', queueDepth: 5 })
    expect(result.type).toBe('runtime.metadata')
  })

  it('maps session_info_changed to runtime.metadata', () => {
    const result = amaEventFromRuntimeEvent({ type: 'session_info_changed', title: 'New' })
    expect(result.type).toBe('runtime.metadata')
  })

  it('maps runner.usage to usage.recorded via matchesRuntimeEvent', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'runner.usage',
      promptTokens: 10,
    })
    expect(result.type).toBe('usage.recorded')
  })

  it('maps ama.usage to usage.recorded via matchesRuntimeEvent', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'ama.usage',
      promptTokens: 5,
    })
    expect(result.type).toBe('usage.recorded')
  })

  it('maps claude-code.error to runtime.error via matchesRuntimeEvent', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'claude-code.error',
      error: { message: 'fail' },
    })
    expect(result.type).toBe('runtime.error')
  })

  it('maps codex.output to runtime.output via matchesRuntimeEvent', () => {
    const result = amaEventFromRuntimeEvent({
      type: 'codex.output',
      data: 'hello',
    })
    expect(result.type).toBe('runtime.output')
  })
})

describe('amaEventFromRuntimeEvent — metadata runtimeSource', () => {
  it('uses metadata.runtimeSource when provided', () => {
    const result = amaEventFromRuntimeEvent(
      { type: 'agent_start' },
      { runtimeSource: 'my-runner', source: 'ignored' },
    )
    expect(result.metadata?.runtimeSource).toBe('my-runner')
  })

  it('falls back to metadata.source when runtimeSource is absent', () => {
    const result = amaEventFromRuntimeEvent(
      { type: 'agent_start' },
      { source: 'my-source' },
    )
    expect(result.metadata?.runtimeSource).toBe('my-source')
  })

  it('defaults runtimeSource to runtime when neither runtimeSource nor source is in metadata', () => {
    const result = amaEventFromRuntimeEvent({ type: 'agent_start' }, {})
    expect(result.metadata?.runtimeSource).toBe('runtime')
  })
})

describe('amaEventFromRuntimeEvent — withoutType fallback branch (line 219)', () => {
  it('strips type from payload for AMA event types not handled by specific branches', () => {
    // session_checkpoint is a lifecycle AMA type — goes through the final withoutType()
    const result = amaEventFromRuntimeEvent({
      type: 'session_checkpoint',
      checkpointId: 'cp_1',
    })
    expect(result.type).toBe('session_checkpoint')
    expect((result.payload as Record<string, unknown>)).not.toHaveProperty('type')
    expect((result.payload as Record<string, unknown>).checkpointId).toBe('cp_1')
  })
})
