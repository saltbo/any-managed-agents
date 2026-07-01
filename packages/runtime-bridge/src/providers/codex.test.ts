import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeProviderRequest } from '../protocol'

const codexConstructorMock = vi.hoisted(() => vi.fn())
const startThreadMock = vi.hoisted(() => vi.fn())
const resumeThreadMock = vi.hoisted(() => vi.fn())
const runStreamedMock = vi.hoisted(() => vi.fn())

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options: unknown) {
      codexConstructorMock(options)
    }

    startThread(options: unknown) {
      return startThreadMock(options)
    }

    resumeThread(id: string, options: unknown) {
      return resumeThreadMock(id, options)
    }
  },
}))

vi.mock('./cli-host', () => ({
  arrayValue: (value: unknown) => (Array.isArray(value) ? value : []),
  hostHome: (env: Record<string, string>) => env.AMA_RUNTIME_BRIDGE_HOST_HOME,
  normalizeProviderUsage: (value: Record<string, unknown>) => value,
  objectValue: (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
  resolveCliPath: () => undefined,
  sdkEnv: (request: RuntimeProviderRequest) => request.env,
}))

const { codexProvider } = await import('./codex')

function request(overrides: Partial<RuntimeProviderRequest> = {}): RuntimeProviderRequest {
  return {
    type: 'run',
    requestId: 'req_1',
    runtime: 'codex',
    sessionId: 'session_1',
    cwd: '/workspace',
    env: { HOME: '/home/agent' },
    prompt: 'USER_TASK',
    agentSnapshot: {
      systemPrompt: 'SYSTEM_PROMPT',
      skills: ['saltbo/agent-kanban@ak-maintainer'],
      subagents: [{ name: 'reviewer', description: 'Reviews pull requests' }],
    },
    ...overrides,
  }
}

async function* events() {
  yield { type: 'thread.started', thread_id: 'thread_1' }
  yield { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }
}

async function* usageEvents() {
  yield {
    type: 'turn.completed',
    usage: { input_tokens: 2, cached_input_tokens: 1, output_tokens: 3 },
  }
}

async function* commandEvents() {
  yield { type: 'turn.started' }
  yield {
    type: 'item.started',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: "printf 'ok'",
      aggregated_output: '',
      status: 'in_progress',
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: "printf 'ok'",
      aggregated_output: 'ok',
      exit_code: 0,
      status: 'completed',
    },
  }
}

async function* repeatedCommandEvents() {
  yield* commandEvents()
  yield { type: 'turn.completed' }
  yield* commandEvents()
}

afterEach(() => {
  codexConstructorMock.mockClear()
  startThreadMock.mockClear()
  resumeThreadMock.mockClear()
  runStreamedMock.mockClear()
})

describe('codexProvider', () => {
  it('passes agent system prompt through Codex developer instructions without prefixing the user prompt', async () => {
    runStreamedMock.mockResolvedValue({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())

    expect(codexConstructorMock).toHaveBeenCalledWith({
      env: { HOME: '/home/agent' },
      config: {
        features: { apps: false },
        developer_instructions: expect.stringContaining('SYSTEM_PROMPT'),
      },
    })
    const firstCall = codexConstructorMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const codexOptions = firstCall![0] as {
      config: { developer_instructions: string }
    }
    expect(codexOptions.config.developer_instructions).toContain('Skills: saltbo/agent-kanban@ak-maintainer')
    expect(codexOptions.config.developer_instructions).toContain(
      'Available subagents: @reviewer (Reviews pull requests)',
    )
    expect(codexOptions.config).not.toHaveProperty('instructions')
    for await (const _event of handle.events) {
      // drain the stream so async generator cleanup runs
    }
    expect(runStreamedMock).toHaveBeenCalledWith('USER_TASK', { signal: expect.any(AbortSignal) })
  })

  it('continues the same Codex thread for injected prompts', async () => {
    runStreamedMock.mockResolvedValueOnce({ events: events() }).mockResolvedValueOnce({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request({ runtimeConfig: { codexIdleKeepAliveMs: 10 } }))
    const drained = (async () => {
      for await (const _event of handle.events) {
        // drain events
      }
    })()
    await handle.send('FOLLOW_UP')
    await drained

    expect(startThreadMock).toHaveBeenCalledTimes(1)
    expect(runStreamedMock).toHaveBeenNthCalledWith(1, 'USER_TASK', { signal: expect.any(AbortSignal) })
    expect(runStreamedMock).toHaveBeenNthCalledWith(2, 'FOLLOW_UP', { signal: expect.any(AbortSignal) })
  })

  it('normalizes Codex command output into AMA tool results', async () => {
    runStreamedMock.mockResolvedValue({ events: commandEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'assistant',
              content: [
                {
                  type: 'tool_call',
                  toolCall: { id: 'codex:1:item_1', name: 'bash', input: { command: "printf 'ok'" } },
                },
              ],
            }),
          },
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'tool',
              parentToolCallId: 'codex:1:item_1',
              content: [
                {
                  type: 'tool_result',
                  toolCallId: 'codex:1:item_1',
                  result: {
                    content: [{ type: 'text', text: 'ok' }],
                    structuredContent: { aggregatedOutput: 'ok' },
                    exitCode: 0,
                  },
                },
              ],
            }),
          },
        }),
      ]),
    )
  })

  it('scopes reused Codex item ids by turn', async () => {
    runStreamedMock.mockResolvedValue({ events: repeatedCommandEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    const toolCallIds = events
      .flatMap((event) => (event.payload as { message?: { content?: unknown[] } }).message?.content ?? [])
      .flatMap((block) => {
        const value = block as { type?: string; toolCall?: { id?: string }; toolCallId?: string }
        if (value.type === 'tool_call') return [value.toolCall?.id]
        if (value.type === 'tool_result') return [value.toolCallId]
        return []
      })

    expect(toolCallIds).toEqual(['codex:1:item_1', 'codex:1:item_1', 'codex:2:item_1', 'codex:2:item_1'])
  })

  it('does not emit model usage when Codex SDK events do not report the actual model', async () => {
    runStreamedMock.mockResolvedValue({ events: usageEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request({ provider: 'workers-ai', model: 'configured-model' }))
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'usage.recorded')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('workers-ai')
    expect(JSON.stringify(events)).not.toContain('configured-model')
  })
})
