import { describe, expect, it } from 'vitest'
import type { EventRecord } from '@/lib/amarpc'
import { buildSessionToolTrace, summarizeToolValue } from './session-tool-trace'

let sequence = 0

type EventRecordOverrides = Partial<Omit<EventRecord, 'event'>> & {
  type?: EventRecord['event']['type']
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  event?: EventRecord['event']
}

function buildEvent(overrides: EventRecordOverrides): EventRecord {
  sequence += 1
  const {
    type = overrides.event?.type ?? 'tool_call.started',
    payload = overrides.event?.payload ?? {},
    metadata = overrides.event?.metadata ?? {},
    event: eventOverride,
    ...recordOverrides
  } = overrides
  return {
    id: `event_${sequence}`,
    projectId: 'project_1',
    sessionId: 'session_1',
    sequence,
    event: eventOverride ?? ({ type, payload, metadata } as EventRecord['event']),
    createdAt: '2026-05-23T00:00:00.000Z',
    ...recordOverrides,
  }
}

function toolStart(toolCallId: string, overrides: EventRecordOverrides = {}) {
  return buildEvent({
    type: 'tool_call.started',
    payload: { toolCall: { id: toolCallId, name: 'bash', input: { command: 'git status' } } },
    ...overrides,
  })
}

function toolEnd(toolCallId: string, overrides: EventRecordOverrides = {}) {
  return buildEvent({
    type: 'tool_call.completed',
    payload: {
      toolCall: { id: toolCallId, name: 'bash', input: { command: 'git status' } },
      result: { content: [{ type: 'text', text: 'clean tree' }], details: {} },
      isError: false,
    },
    ...overrides,
  })
}

describe('buildSessionToolTrace', () => {
  it('pairs a tool result with its call through the canonical correlation id', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1', { createdAt: '2026-05-23T00:00:00.000Z' }),
      toolEnd('call_1', { createdAt: '2026-05-23T00:00:00.250Z' }),
    ])

    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({
      toolCallId: 'call_1',
      name: 'bash',
      status: 'completed',
      approval: 'approved',
      orphanedResult: false,
      input: { command: 'git status' },
      errorSummary: null,
      durationMs: 250,
      startedAt: '2026-05-23T00:00:00.000Z',
      completedAt: '2026-05-23T00:00:00.250Z',
    })
  })

  it('prefers the payload durationMs over the timestamp delta', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1', { createdAt: '2026-05-23T00:00:00.000Z' }),
      toolEnd('call_1', {
        createdAt: '2026-05-23T00:00:09.000Z',
        payload: {
          toolCall: { id: 'call_1', name: 'bash', input: { command: 'git status' } },
          result: {},
          isError: false,
          durationMs: 1250,
        },
      }),
    ])

    expect(trace[0]?.durationMs).toBe(1250)
  })

  it('keeps repeated correlation ids as separate executions', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1'),
      toolEnd('call_1'),
      toolStart('call_1'),
      toolEnd('call_1', {
        payload: {
          toolCall: { id: 'call_1', name: 'bash', input: { command: 'git status' } },
          result: { content: [{ type: 'text', text: 'Sandbox command is blocked by policy.' }] },
          isError: true,
        },
      }),
    ])

    expect(trace).toHaveLength(2)
    expect(trace[0]?.status).toBe('completed')
    expect(trace[1]?.status).toBe('failed')
    expect(trace[1]?.errorSummary).toBe('Sandbox command is blocked by policy.')
  })

  it('marks failed results and exposes a bounded safe error summary', () => {
    const longError = 'x'.repeat(400)
    const trace = buildSessionToolTrace([
      toolStart('call_1'),
      toolEnd('call_1', {
        payload: {
          toolCall: { id: 'call_1', name: 'bash', input: { command: 'git status' } },
          result: { content: [{ type: 'text', text: longError }] },
          isError: true,
        },
      }),
    ])

    expect(trace[0]?.status).toBe('failed')
    expect(trace[0]?.errorSummary).toHaveLength(241)
    expect(trace[0]?.errorSummary?.endsWith('…')).toBe(true)
  })

  it('degrades an orphaned result into an explicit entry instead of dropping it', () => {
    const trace = buildSessionToolTrace([toolEnd('call_orphan')])

    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({
      orphanedResult: true,
      status: 'completed',
      name: 'bash',
      input: { command: 'git status' },
      startedAt: null,
      durationMs: null,
    })
  })

  it('derives the approval state from an in-flight policy denial in the same turn', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1'),
      buildEvent({
        type: 'permission.denied',
        payload: { reason: 'sandbox_command_denied', command: 'git status' },
      }),
      toolEnd('call_1', {
        payload: { toolCallId: 'call_1', toolName: 'bash', result: {}, isError: true },
      }),
    ])

    expect(trace[0]?.approval).toBe('denied')
  })

  it('reports approval-category denials as approval required', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1'),
      buildEvent({
        type: 'permission.requested',
        payload: { permissionId: 'approval_1', command: 'git status' },
      }),
      toolEnd('call_1', {
        payload: { toolCallId: 'call_1', toolName: 'bash', result: {}, isError: true },
      }),
    ])

    expect(trace[0]?.approval).toBe('approval required')
  })

  it('uses permission resolution as the final approval state', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1'),
      buildEvent({
        type: 'permission.requested',
        payload: { permissionId: 'approval_1', command: 'git status' },
      }),
      buildEvent({
        type: 'permission.resolved',
        payload: { permissionId: 'approval_1', allowed: true, command: 'git status' },
      }),
      toolEnd('call_1'),
    ])

    expect(trace[0]?.approval).toBe('approved')
  })

  it('ignores denials from other turns and denials for other commands', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1'),
      buildEvent({
        type: 'permission.denied',
        payload: { reason: 'sandbox_command_denied', command: 'rm -rf /' },
      }),
      toolEnd('call_1'),
    ])

    expect(trace[0]?.approval).toBe('approved')
  })

  it('keeps redacted values intact and ignores non-tool events', () => {
    const trace = buildSessionToolTrace([
      buildEvent({ type: 'message.completed', payload: { message: { role: 'assistant', content: 'hi' } } }),
      toolStart('call_1', {
        payload: { toolCall: { id: 'call_1', name: 'bash', input: { command: 'deploy', apiKey: '[REDACTED]' } } },
      }),
      toolEnd('call_1'),
    ])

    expect(trace).toHaveLength(1)
    expect(trace[0]?.input).toEqual({ command: 'deploy', apiKey: '[REDACTED]' })
  })

  it('orders executions by event sequence even when events arrive unsorted', () => {
    const start = toolStart('call_1')
    const end = toolEnd('call_1')
    const trace = buildSessionToolTrace([end, start])

    expect(trace).toHaveLength(1)
    expect(trace[0]?.status).toBe('completed')
  })
})

describe('summarizeToolValue', () => {
  it('extracts text content blocks and collapses whitespace', () => {
    expect(summarizeToolValue({ content: [{ type: 'text', text: 'line one\nline   two' }] })).toBe('line one line two')
  })

  it('falls back to JSON for structured values and truncates long output', () => {
    expect(summarizeToolValue({ command: 'git status' })).toBe('{"command":"git status"}')
    const summary = summarizeToolValue('y'.repeat(500))
    expect(summary).toHaveLength(161)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('reports missing values as None', () => {
    expect(summarizeToolValue(undefined)).toBe('None')
    expect(summarizeToolValue('')).toBe('None')
  })

  it('handles numeric values', () => {
    expect(summarizeToolValue(42)).toBe('42')
  })

  it('handles boolean values', () => {
    expect(summarizeToolValue(true)).toBe('true')
    expect(summarizeToolValue(false)).toBe('false')
  })

  it('handles null value', () => {
    expect(summarizeToolValue(null)).toBe('None')
  })

  it('handles content array with non-text items by returning JSON', () => {
    expect(summarizeToolValue({ content: [{ type: 'image', url: 'http://example.com/img.png' }] })).toContain('content')
  })
})

describe('buildSessionToolTrace — approval edge cases', () => {
  it('ignores denial that occurs after tool call ended (sequence out of range)', () => {
    const start = toolStart('call_in_range')
    const end = toolEnd('call_in_range')
    // Build a denial with sequence after the tool end event
    const afterEndDenial = buildEvent({
      type: 'permission.denied',
      sequence: end.sequence + 10,
      payload: { reason: 'sandbox_command_denied', command: 'git status' },
    })
    const trace = buildSessionToolTrace([start, end, afterEndDenial])

    // Denial is outside the tool call window — should be approved
    expect(trace[0]?.approval).toBe('approved')
  })

  it('treats denial with no command as matching any tool call command', () => {
    const trace = buildSessionToolTrace([
      toolStart('call_1'),
      buildEvent({
        type: 'permission.denied',
        payload: { reason: 'sandbox_command_denied' }, // no command field
      }),
      toolEnd('call_1', {
        payload: { toolCallId: 'call_1', toolName: 'bash', result: {}, isError: true },
      }),
    ])

    expect(trace[0]?.approval).toBe('denied')
  })

  it('pairs tool with start having no command against denial with no command', () => {
    // Tool input has no command field, denial has no command field — both match
    const startNoCommand = buildEvent({
      type: 'tool_call.started',
      payload: { toolCallId: 'call_nocmd', toolName: 'bash', args: { path: '/tmp' } },
    })
    const trace = buildSessionToolTrace([
      startNoCommand,
      buildEvent({
        type: 'permission.denied',
        payload: { reason: 'sandbox_command_denied' },
      }),
      toolEnd('call_nocmd', {
        payload: { toolCallId: 'call_nocmd', toolName: 'bash', result: {}, isError: true },
      }),
    ])

    expect(trace[0]?.approval).toBe('denied')
  })

  it('produces an orphaned failed entry when only an error end event is present', () => {
    const trace = buildSessionToolTrace([
      toolEnd('call_orphan_err', {
        payload: {
          toolCallId: 'call_orphan_err',
          toolName: 'bash',
          result: { content: [{ type: 'text', text: 'Permission denied' }] },
          isError: true,
        },
      }),
    ])

    expect(trace).toHaveLength(1)
    expect(trace[0]?.orphanedResult).toBe(true)
    expect(trace[0]?.status).toBe('failed')
    expect(trace[0]?.errorSummary).toBe('Permission denied')
  })

  it('falls back to durationMs=null for orphaned entry without payload durationMs', () => {
    const trace = buildSessionToolTrace([toolEnd('call_no_dur')])

    expect(trace[0]?.durationMs).toBeNull()
  })
})
