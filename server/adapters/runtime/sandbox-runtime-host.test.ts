import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const { getSandboxMock, mockExecutor, mockSandbox, toolExecutorMock } = vi.hoisted(() => {
  const mockSandbox = {
    exec: vi.fn(),
    writeFile: vi.fn(),
    setEnvVars: vi.fn(),
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

vi.mock('./sandbox-tool-executor', () => ({
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
} from './sandbox-runtime-host'

describe('session-runtime', () => {
  beforeEach(() => {
    mockExecutor.execute.mockReset()
    mockExecutor.stop.mockReset()
    mockSandbox.exec.mockReset()
    mockSandbox.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    mockSandbox.writeFile.mockReset()
    mockSandbox.setEnvVars.mockReset()
    getSandboxMock.mockClear()
    toolExecutorMock.mockClear()
  })

  it('builds AMA runtime endpoint paths from the session id [spec: runtime/endpoints]', () => {
    expect(runtimeEndpointPath('session_123')).toBe('/api/v1/runtime/sessions/session_123/rpc')
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
    ).resolves.toMatchObject({
      sandboxId: 'sandbox_123',
      runtimeEndpointPath: '/api/v1/runtime/sessions/session_123/rpc',
      metadata: expect.objectContaining({
        runtimeMode: 'test',
        runtimeDriver: 'ama-cloud',
        runtimeBackend: 'ama-cloud',
        runtimeProtocol: 'ama-runtime-rpc',
        loop: 'cloud-session-runtime',
        executor: 'cloudflare-sandbox',
        piCorePackage: '@earendil-works/pi-agent-core',
        resourceManifestPath: '/workspace/.ama/resources.json',
        runtimeEnvPath: '/workspace/.ama/runtime-env.json',
        runtimeSecretEnvPath: '/workspace/.ama/runtime-secret-env.json',
      }),
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
          credentialRef: { credentialId: 'vaultcred_123' },
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
          credentialRef: { credentialId: 'vaultcred_123' },
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

  it('runs a prompt through Pi Core and dispatches model tool calls through the executor [spec: runtime/turn]', async () => {
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
      agentSnapshot: { instructions: 'Inspect before answering.', tools: [{ name: 'sandbox.exec' }] },
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
      agentSnapshot: { instructions: 'Remember prior turns.', tools: [{ name: 'sandbox.exec' }] },
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
      agentSnapshot: { instructions: 'Remember prior turns.', tools: [{ name: 'sandbox.exec' }] },
      prompt: 'What was my previous prompt?',
      messages: runtimeMessagesFromEvents(firstTurnEvents.map((event) => ({ payload: event }))),
      onEvent: async (event) => {
        secondTurnEvents.push(event)
      },
    })

    expect(JSON.stringify(secondTurnEvents)).toContain('Previous user prompt: Alpha durable prompt')
  })

  it('pauses a multi-turn run at the budget boundary and finishes via continuation', async () => {
    mockExecutor.execute.mockResolvedValue({
      toolCallId: 'call_git_status',
      toolName: 'sandbox.exec',
      output: { stdout: 'clean' },
      error: null,
      durationMs: 5,
    })

    const firstEvents: Record<string, unknown>[] = []
    const first = await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Inspect before answering.', tools: [{ name: 'sandbox.exec' }] },
      prompt: 'Inspect repository status',
      shouldPause: () => true,
      onEvent: async (event) => {
        firstEvents.push(event)
      },
    })

    // The tool-call turn completed and persisted, then the run paused instead
    // of starting the next model turn.
    expect(first).toEqual({ status: 'paused' })
    expect(JSON.stringify(firstEvents)).toContain('tool_execution_end')
    expect(JSON.stringify(firstEvents)).not.toContain('Tool result observed')

    const secondEvents: Record<string, unknown>[] = []
    const second = await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Inspect before answering.', tools: [{ name: 'sandbox.exec' }] },
      continuation: true,
      messages: runtimeMessagesFromEvents(firstEvents.map((event) => ({ payload: event }))),
      onEvent: async (event) => {
        secondEvents.push(event)
      },
    })

    expect(second).toEqual({ status: 'idle' })
    expect(JSON.stringify(secondEvents)).toContain('Tool result observed')
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

  it('ignores canonical transcript deltas when rebuilding persisted context', () => {
    const messages = runtimeMessagesFromEvents([
      {
        type: 'message_update',
        payload: {
          message: { role: 'assistant', content: 'partial assistant text' },
        },
      },
      {
        type: 'message_end',
        payload: {
          message: { role: 'assistant', content: 'completed assistant text' },
        },
      },
    ])

    expect(messages).toEqual([{ role: 'assistant', content: 'completed assistant text' }])
  })

  it('sends canonical string assistant history to the live provider', async () => {
    const aiRun = vi.fn().mockResolvedValue({ response: 'continued' })
    const events: Record<string, unknown>[] = []

    await runSessionTurn({ AMA_RUNTIME_MODE: 'live', AI: { run: aiRun } } as unknown as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Continue from history.', tools: [] },
      messages: runtimeMessagesFromEvents([
        { type: 'message_end', payload: { message: { role: 'assistant', content: 'Acknowledged.' } } },
      ]),
      prompt: 'Continue',
      onEvent: async (event) => {
        events.push(event)
      },
    })

    expect(aiRun).toHaveBeenCalledWith(
      '@cf/moonshotai/kimi-k2.6',
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'assistant', content: 'Acknowledged.' }]),
      }),
      expect.any(Object),
    )
    expect(JSON.stringify(events)).toContain('continued')
  })

  it('stops before model completion events are persisted when the DB cancellation gate trips [spec: runtime/cooperative-cancellation]', async () => {
    const events: Record<string, unknown>[] = []
    let active = true

    const result = await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Stop cleanly.', tools: [{ name: 'sandbox.exec' }] },
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

  it('does not dispatch sandbox tools that are absent from a non-empty allow-list [spec: runtime/error-termination] [spec: runtime/sandbox-toolset]', async () => {
    const events: Record<string, unknown>[] = []

    await expect(
      runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { instructions: 'Inspect before answering.', tools: [{ name: 'sandbox.read' }] },
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

  it('grants the full sandbox toolset when the agent has no explicit allow-list', async () => {
    mockExecutor.execute.mockResolvedValueOnce({
      toolCallId: 'call_git_status',
      toolName: 'sandbox.exec',
      output: { stdout: 'clean' },
      error: null,
      durationMs: 5,
    })

    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { instructions: 'Inspect before answering.', tools: [] },
      prompt: 'Inspect repository status',
      onEvent: async () => {},
    })

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'sandbox.exec' }),
      expect.anything(),
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
        runtimeEnv: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_123' },
        runtimeSecretEnv: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'cred_abc123' } }],
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
      runtimeEndpointPath: '/api/v1/runtime/sessions/session_123/rpc',
      metadata: expect.objectContaining({
        runtimeMode: 'live',
        runtimeDriver: 'ama-cloud',
        runtimeBackend: 'ama-cloud',
        runtimeProtocol: 'ama-runtime-rpc',
        loop: 'cloud-session-runtime',
        runtimeEnvPath: '/workspace/.ama/runtime-env.json',
        runtimeSecretEnvPath: '/workspace/.ama/runtime-secret-env.json',
      }),
    })

    expect(getSandboxMock).toHaveBeenCalledWith({}, 'sandbox_123', { keepAlive: true, normalizeId: true })
    expect(mockSandbox.exec).toHaveBeenCalledWith('mkdir -p /workspace/.ama')
    expect(mockSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/.ama/session.json',
      expect.stringContaining(
        '"runtimeSecretEnv":[{"name":"AK_AGENT_KEY","credentialRef":{"credentialId":"cred_abc123"}}]',
      ),
      { encoding: 'utf-8' },
    )
    expect(mockSandbox.setEnvVars).toHaveBeenCalledWith({
      AK_API_URL: 'https://ak.example.com',
      AK_AGENT_ID: 'agent_123',
    })
    expect(mockSandbox.exec).toHaveBeenCalledWith(
      "git clone https://github.com/saltbo/any-managed-agents.git '/workspace/repos/saltbo/any-managed-agents'",
      { timeout: 120_000 },
    )
    expect(mockSandbox.exec).toHaveBeenCalledWith(
      "git -C '/workspace/repos/saltbo/any-managed-agents' checkout 'main'",
      undefined,
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
            status: 'cloned',
          },
        ],
      }),
      { encoding: 'utf-8' },
    )
    expect(mockSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/.ama/runtime-env.json',
      JSON.stringify({ AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_123' }),
      { encoding: 'utf-8' },
    )
    expect(mockSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/.ama/runtime-secret-env.json',
      JSON.stringify([{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'cred_abc123' } }]),
      { encoding: 'utf-8' },
    )
  })

  it('stops the configured executor backend for a sandbox', async () => {
    await stopSessionRuntime({ AMA_RUNTIME_MODE: 'test' } as Env, 'sandbox_123')

    expect(toolExecutorMock).toHaveBeenCalledTimes(1)
    expect(mockExecutor.stop).toHaveBeenCalledWith('sandbox_123')
  })
})
