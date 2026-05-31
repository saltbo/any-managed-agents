import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'

const { getSandboxMock, mockExecutor, mockSandbox, toolExecutorMock } = vi.hoisted(() => {
  const mockSandbox = {
    exec: vi.fn(),
    writeFile: vi.fn(),
  }
  const mockExecutor = {
    execute: vi.fn(),
    stop: vi.fn(),
  }
  return {
    getSandboxMock: vi.fn(() => mockSandbox),
    mockExecutor,
    mockSandbox,
    toolExecutorMock: vi.fn(() => mockExecutor),
  }
})

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: getSandboxMock,
}))

vi.mock('./tool-executor', () => ({
  toolExecutor: toolExecutorMock,
}))

import {
  executeRuntimeToolCalls,
  RuntimeTurnCancelledError,
  runSessionTurn,
  runtimeEndpointPath,
  runtimeMessagesFromEvents,
  runtimeToolCalls,
  startSessionRuntime,
  stopSessionRuntime,
  workspaceResourceManifest,
} from './session-runtime'

describe('session-runtime', () => {
  beforeEach(() => {
    mockExecutor.execute.mockReset()
    mockExecutor.stop.mockReset()
    mockSandbox.exec.mockReset()
    mockSandbox.writeFile.mockReset()
    getSandboxMock.mockClear()
    toolExecutorMock.mockClear()
  })

  it('builds AMA runtime endpoint paths from the session id', () => {
    expect(runtimeEndpointPath('session_123')).toBe('/runtime/sessions/session_123/rpc')
  })

  it('extracts only object tool calls from runtime command bodies', () => {
    expect(runtimeToolCalls(null)).toEqual([])
    expect(runtimeToolCalls({})).toEqual([])
    expect(
      runtimeToolCalls({
        toolCalls: [null, 'bad', { id: 'tool_1', name: 'sandbox.exec' }],
      }),
    ).toEqual([{ id: 'tool_1', name: 'sandbox.exec' }])
  })

  it('dispatches runtime tool calls through the configured executor', async () => {
    mockExecutor.execute.mockResolvedValueOnce({
      toolCallId: 'call_git_status',
      toolName: 'sandbox.exec',
      output: { stdout: 'clean' },
      error: null,
      durationMs: 42,
    })

    const results = await executeRuntimeToolCalls({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      body: {
        toolCalls: [
          {
            id: 'call_git_status',
            name: 'sandbox.exec',
            input: { command: 'git status' },
            output: { stdout: 'clean' },
            durationMs: 42,
          },
        ],
      },
    })

    expect(toolExecutorMock).toHaveBeenCalledTimes(1)
    expect(mockExecutor.execute).toHaveBeenNthCalledWith(1, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      toolCallId: 'call_git_status',
      toolName: 'sandbox.exec',
      input: {
        command: 'git status',
        output: { stdout: 'clean' },
        durationMs: 42,
      },
      cwd: '/workspace',
    })
    expect(results).toEqual([
      {
        toolCallId: 'call_git_status',
        toolName: 'sandbox.exec',
        output: { stdout: 'clean' },
        error: null,
        durationMs: 42,
      },
    ])
  })

  it('returns cloud-owned runtime metadata in test mode', async () => {
    await expect(
      startSessionRuntime({ AMA_RUNTIME_MODE: 'test' } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { instructions: 'Test runtime' },
        environmentSnapshot: { runtimeConfig: { image: 'ama-tool-executor' } },
      }),
    ).resolves.toEqual({
      sandboxId: 'sandbox_123',
      runtimeEndpointPath: '/runtime/sessions/session_123/rpc',
      metadata: {
        runtimeMode: 'test',
        runtimeOwner: 'ama-cloud',
        loop: 'cloud-session-runtime',
        executor: 'cloudflare-sandbox',
        piCorePackage: '@earendil-works/pi-agent-core',
        resourceManifestPath: '/workspace/.ama/resources.json',
      },
    })
  })

  it('builds a deterministic workspace resource manifest', () => {
    expect(
      workspaceResourceManifest([
        {
          type: 'github_repository',
          owner: 'saltbo',
          repo: 'zeta',
          ref: 'main',
          mountPath: '/workspace/repos/saltbo/zeta',
        },
        {
          type: 'repository',
          id: 'legacy_repo',
        },
        {
          type: 'github_repository',
          owner: 'saltbo',
          repo: 'alpha',
          ref: 'release',
          mountPath: '/workspace/repos/saltbo/alpha',
          credentialRef: 'vaultcred_123',
        },
      ]),
    ).toEqual({
      version: 1,
      workspaceRoot: '/workspace',
      resources: [
        {
          type: 'github_repository',
          owner: 'saltbo',
          repo: 'alpha',
          ref: 'release',
          mountPath: '/workspace/repos/saltbo/alpha',
          credentialRef: 'vaultcred_123',
          status: 'declared',
        },
        {
          type: 'github_repository',
          owner: 'saltbo',
          repo: 'zeta',
          ref: 'main',
          mountPath: '/workspace/repos/saltbo/zeta',
          status: 'declared',
        },
      ],
    })
  })

  it('runs a prompt through Pi Core and dispatches model tool calls through the executor', async () => {
    mockExecutor.execute.mockResolvedValueOnce({
      toolCallId: 'call_git_status',
      toolName: 'sandbox.exec',
      output: { stdout: 'clean', stderr: '', exitCode: 0 },
      error: null,
      durationMs: 5,
    })
    const events: Record<string, unknown>[] = []

    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Inspect before answering.', allowedTools: ['sandbox.exec'] },
      prompt: 'Inspect repository status',
      onEvent: async (event) => {
        events.push(event)
      },
    })

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_git_status',
        toolName: 'sandbox.exec',
        input: { command: 'git status' },
        cwd: '/workspace',
      },
      expect.any(AbortSignal),
    )
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'agent_start',
        'message_end',
        'tool_execution_start',
        'tool_execution_end',
        'usage',
        'agent_end',
      ]),
    )
    expect(JSON.stringify(events)).toContain('Tool result observed: clean')
    expect(JSON.stringify(events)).not.toContain('Message accepted by AMA runtime.')
    expect(JSON.stringify(events)).not.toContain('Received:')
  })

  it('reconstructs the next turn context from persisted Pi Core events', async () => {
    const firstTurnEvents: Record<string, unknown>[] = []
    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Remember prior turns.', allowedTools: ['sandbox.exec'] },
      prompt: 'Alpha durable prompt',
      onEvent: async (event) => {
        firstTurnEvents.push(event)
      },
    })

    const secondTurnEvents: Record<string, unknown>[] = []
    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Remember prior turns.', allowedTools: ['sandbox.exec'] },
      prompt: 'What was my previous prompt?',
      messages: runtimeMessagesFromEvents(firstTurnEvents.map((event) => ({ payload: event }))),
      onEvent: async (event) => {
        secondTurnEvents.push(event)
      },
    })

    expect(JSON.stringify(secondTurnEvents)).toContain('Previous user prompt: Alpha durable prompt')
  })

  it('uses latest agent_end messages as canonical persisted context', () => {
    const messages = runtimeMessagesFromEvents([
      {
        payload: {
          type: 'message_end',
          message: { role: 'user', content: 'stale fallback', timestamp: 1 },
        },
      },
      {
        payload: {
          type: 'agent_end',
          messages: [
            { role: 'user', content: 'canonical user', timestamp: 2 },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'canonical assistant' }],
              api: 'ama-workers-ai',
              provider: 'cloudflare-workers-ai',
              model: '@cf/moonshotai/kimi-k2.6',
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: 'stop',
              timestamp: 3,
            },
          ],
        },
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'canonical user' })
  })

  it('stops before model completion events are persisted when the DB cancellation gate trips', async () => {
    const events: Record<string, unknown>[] = []
    let active = true

    const result = await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Stop cleanly.', allowedTools: ['sandbox.exec'] },
      prompt: 'Alpha durable prompt',
      ensureActive: async () => {
        if (!active) {
          throw new RuntimeTurnCancelledError()
        }
      },
      onEvent: async (event) => {
        if (event.type === 'turn_start') {
          active = false
        }
        events.push(event)
      },
    })

    expect(result).toEqual({ status: 'aborted' })
    expect(events.map((event) => event.type)).not.toContain('message_end')
    expect(JSON.stringify(events)).not.toContain('AMA runtime processed: Alpha durable prompt')
  })

  it('does not dispatch sandbox tools that are absent from the agent snapshot allow-list', async () => {
    const events: Record<string, unknown>[] = []

    await expect(
      runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { instructions: 'Inspect before answering.', allowedTools: [] },
        prompt: 'Inspect repository status',
        onEvent: async (event) => {
          events.push(event)
        },
      }),
    ).rejects.toThrow()

    expect(mockExecutor.execute).not.toHaveBeenCalled()
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_execution_end',
          isError: true,
        }),
      ]),
    )
  })

  it('initializes sandbox workspace metadata in live mode without starting a Pi process', async () => {
    await expect(
      startSessionRuntime({ AMA_RUNTIME_MODE: 'live', SANDBOX: {} } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { instructions: 'Test runtime' },
        environmentSnapshot: { runtimeConfig: { image: 'ama-tool-executor' } },
        mcpSnapshot: { connectors: ['github'] },
        resourceRefs: [
          {
            type: 'github_repository',
            owner: 'saltbo',
            repo: 'any-managed-agents',
            ref: 'main',
            mountPath: '/workspace/repos/saltbo/any-managed-agents',
          },
        ],
      }),
    ).resolves.toMatchObject({
      sandboxId: 'sandbox_123',
      runtimeEndpointPath: '/runtime/sessions/session_123/rpc',
      metadata: expect.objectContaining({
        runtimeMode: 'live',
        runtimeOwner: 'ama-cloud',
        loop: 'cloud-session-runtime',
      }),
    })

    expect(getSandboxMock).toHaveBeenCalledWith({}, 'sandbox_123', { keepAlive: true, normalizeId: true })
    expect(mockSandbox.exec).toHaveBeenCalledWith('mkdir -p /workspace/.ama')
    expect(mockSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/.ama/session.json',
      expect.stringContaining('"runtimeOwner":"ama-cloud"'),
      { encoding: 'utf-8' },
    )
    expect(mockSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/.ama/resources.json',
      JSON.stringify({
        version: 1,
        workspaceRoot: '/workspace',
        resources: [
          {
            type: 'github_repository',
            owner: 'saltbo',
            repo: 'any-managed-agents',
            mountPath: '/workspace/repos/saltbo/any-managed-agents',
            ref: 'main',
            status: 'declared',
          },
        ],
      }),
      { encoding: 'utf-8' },
    )
  })

  it('stops the configured executor backend for a sandbox', async () => {
    await stopSessionRuntime({ AMA_RUNTIME_MODE: 'test' } as Env, 'sandbox_123')

    expect(toolExecutorMock).toHaveBeenCalledTimes(1)
    expect(mockExecutor.stop).toHaveBeenCalledWith('sandbox_123')
  })
})
