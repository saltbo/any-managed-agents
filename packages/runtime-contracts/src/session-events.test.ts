import { describe, expect, it } from 'vitest'
import {
  AMA_SESSION_EVENT_TYPES,
  type AmaEvent,
  AmaEventSchema,
  amaSessionEventTypeFromPayload,
  EventRecordSchema,
  isAmaSessionEventType,
  type Message,
  MessageContentBlockSchema,
  normalizeAmaEvent,
  type ToolResult,
} from './session-events'

const message: Message = {
  id: 'msg_1',
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
  stopReason: 'end_turn',
}

const toolCall = { id: 'call_1', name: 'bash', input: { command: 'echo ok' } }
const toolResult: ToolResult = {
  content: [{ type: 'text', text: 'ok' }],
  structuredContent: { output: 'ok' },
  exitCode: 0,
}

const eventFixtures: AmaEvent[] = [
  { type: 'runtime.started', payload: {} },
  { type: 'runtime.completed', payload: { reason: 'done' } },
  { type: 'turn.started', payload: { status: 'running', message } },
  { type: 'turn.completed', payload: { status: 'completed', reason: 'stop' } },
  { type: 'message.started', payload: { message } },
  { type: 'message.updated', payload: { message } },
  { type: 'message.completed', payload: { message } },
  {
    type: 'usage.recorded',
    payload: { model: 'gpt', totalTokens: 10, details: { cached: false } },
  },
  {
    type: 'permission.requested',
    payload: { permissionId: 'perm_1', command: 'rm', toolCall, details: { policy: 'approval' } },
  },
  {
    type: 'permission.resolved',
    payload: { permissionId: 'perm_1', allowed: true, reason: 'ok', toolCall, details: { source: 'user' } },
  },
  {
    type: 'permission.denied',
    payload: { reason: 'blocked', operation: 'command', command: 'rm', host: null, details: { rule: 'deny' } },
  },
  {
    type: 'runtime.error',
    payload: { message: 'failed', code: 'runtime_exit', retryable: false, details: { stderr: 'x' } },
  },
]

describe('AmaEventSchema', () => {
  it('accepts every canonical event with its typed payload', () => {
    expect(eventFixtures.map((event) => event.type)).toEqual(AMA_SESSION_EVENT_TYPES)
    for (const event of eventFixtures) {
      expect(AmaEventSchema.safeParse(event).success, event.type).toBe(true)
    }
  })

  it('rejects invalid event names, payload fields, metadata fields, and non-json leaves', () => {
    expect(AmaEventSchema.safeParse({ type: 'message.delta', payload: {} }).success).toBe(false)
    expect(AmaEventSchema.safeParse({ type: 'message.completed', payload: { message, delta: 'x' } }).success).toBe(
      false,
    )
    expect(
      AmaEventSchema.safeParse({ type: 'turn.completed', payload: {}, metadata: { runnerId: 'runner_1' } }).success,
    ).toBe(false)
    expect(
      MessageContentBlockSchema.safeParse({ type: 'tool_call', toolCall: { ...toolCall, input: () => undefined } })
        .success,
    ).toBe(false)
    expect(
      AmaEventSchema.safeParse({ type: 'usage.recorded', payload: { provider: 'openai', totalTokens: 1 } }).success,
    ).toBe(false)
    expect(MessageContentBlockSchema.safeParse({ type: 'unknown', value: { raw: true } }).success).toBe(false)
    expect(
      MessageContentBlockSchema.safeParse({ type: 'text', text: 'hello', metadata: { source: 'x' } }).success,
    ).toBe(false)
  })

  it('keeps extensibility inside details and structured content only', () => {
    expect(
      AmaEventSchema.parse({
        type: 'message.completed',
        payload: {
          message: {
            id: 'msg_tool_result',
            role: 'tool',
            parentToolCallId: toolCall.id,
            content: [
              {
                type: 'tool_result',
                toolCallId: toolCall.id,
                result: {
                  content: [{ type: 'text', text: 'ok' }],
                  structuredContent: { providerOutput: { stdout: 'ok' } },
                },
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      payload: {
        message: {
          content: [
            {
              result: { structuredContent: { providerOutput: { stdout: 'ok' } } },
            },
          ],
        },
      },
    })
  })
})

describe('MessageContentBlockSchema', () => {
  it('accepts all content block variants without flattening nested tool data', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'reasoning', text: 'thinking' },
      { type: 'tool_call', toolCall },
      { type: 'tool_result', toolCallId: 'call_1', result: toolResult, error: { message: 'failed' } },
      { type: 'image', url: 'https://example.com/a.png', mediaType: 'image/png', data: 'base64' },
      { type: 'file', path: '/tmp/a.txt', name: 'a.txt', mediaType: 'text/plain', data: 'hello' },
    ]
    for (const block of blocks) {
      expect(MessageContentBlockSchema.safeParse(block).success, block.type).toBe(true)
    }
  })
})

describe('EventRecordSchema', () => {
  it('accepts persisted records wrapping a canonical AMA event', () => {
    expect(
      EventRecordSchema.parse({
        id: 'evt_1',
        sessionId: 'session_1',
        sequence: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        event: eventFixtures[0],
      }),
    ).toMatchObject({ id: 'evt_1' })
  })

  it('rejects non-canonical persisted records', () => {
    expect(
      EventRecordSchema.safeParse({
        id: 'evt_1',
        sessionId: 'session_1',
        sequence: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        event: { type: 'unknown', payload: {} },
      }).success,
    ).toBe(false)
  })

  it('[spec: sessions/events-hierarchy] preserves record order and message/tool relationships', () => {
    const records = [
      EventRecordSchema.parse({
        id: 'evt_turn_started',
        sessionId: 'session_1',
        sequence: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        event: {
          type: 'turn.started',
          payload: {
            message: {
              id: 'msg_user_1',
              role: 'user',
              content: [{ type: 'text', text: 'whoami' }],
            },
          },
        },
      }),
      EventRecordSchema.parse({
        id: 'evt_tool_call',
        sessionId: 'session_1',
        sequence: 2,
        createdAt: '2026-01-01T00:00:01.000Z',
        event: {
          type: 'message.completed',
          payload: {
            message: {
              id: 'msg_assistant_1',
              role: 'assistant',
              parentMessageId: 'msg_user_1',
              content: [{ type: 'tool_call', toolCall }],
            },
          },
        },
      }),
      EventRecordSchema.parse({
        id: 'evt_tool_result',
        sessionId: 'session_1',
        sequence: 3,
        createdAt: '2026-01-01T00:00:02.000Z',
        event: {
          type: 'message.completed',
          payload: {
            message: {
              id: 'msg_tool_result_1',
              role: 'tool',
              parentMessageId: 'msg_assistant_1',
              parentToolCallId: toolCall.id,
              content: [{ type: 'tool_result', toolCallId: toolCall.id, result: toolResult }],
            },
          },
        },
      }),
    ]

    expect(records.map((record) => record.sequence)).toEqual([1, 2, 3])
    expect(new Set(records.map((record) => record.id)).size).toBe(records.length)

    const toolCallBlock = records[1].event.payload.message.content[0]
    const toolResultMessage = records[2].event.payload.message
    const toolResultBlock = toolResultMessage.content[0]

    expect(records.every((record) => record.sessionId === 'session_1')).toBe(true)
    expect(records[1].event.payload.message.parentMessageId).toBe('msg_user_1')
    expect(toolCallBlock.type === 'tool_call' ? toolCallBlock.toolCall.id : null).toBe(toolCall.id)
    expect(toolResultMessage.parentMessageId).toBe('msg_assistant_1')
    expect(toolResultMessage.parentToolCallId).toBe(toolCall.id)
    expect(toolResultBlock.type === 'tool_result' ? toolResultBlock.toolCallId : null).toBe(toolCall.id)
  })
})

describe('event helpers', () => {
  it('recognizes event types and reports unknown payload types', () => {
    expect(isAmaSessionEventType('runtime.started')).toBe(true)
    expect(isAmaSessionEventType('not.real')).toBe(false)
    expect(amaSessionEventTypeFromPayload({ type: 'message.completed' })).toBe('message.completed')
    expect(amaSessionEventTypeFromPayload({ type: '' })).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({ type: 1 })).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({})).toBe('unknown')
  })

  it('normalizes events without adding transport metadata', () => {
    expect(normalizeAmaEvent({ type: 'turn.completed', payload: {} })).toEqual({
      type: 'turn.completed',
      payload: {},
    })
  })
})
