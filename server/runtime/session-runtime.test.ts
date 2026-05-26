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
  runtimeEndpointPath,
  runtimeToolCalls,
  startSessionRuntime,
  stopSessionRuntime,
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
    mockExecutor.execute
      .mockResolvedValueOnce({
        toolCallId: 'call_git_status',
        toolName: 'sandbox.exec',
        output: { stdout: 'clean' },
        error: null,
        durationMs: 42,
      })
      .mockResolvedValueOnce({
        toolCallId: 'tool_2',
        toolName: 'tool',
        output: {},
        error: { message: 'failed' },
        durationMs: 7,
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
          {
            error: { message: 'failed' },
            durationMs: 7,
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
    expect(mockExecutor.execute).toHaveBeenNthCalledWith(2, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      toolCallId: 'tool_2',
      toolName: 'tool',
      input: {
        error: { message: 'failed' },
        durationMs: 7,
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
      {
        toolCallId: 'tool_2',
        toolName: 'tool',
        output: {},
        error: { message: 'failed' },
        durationMs: 7,
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
        environmentSnapshot: { runtimeImage: { image: 'ama-tool-executor' } },
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
      },
    })
  })

  it('initializes sandbox workspace metadata in live mode without starting a Pi process', async () => {
    await expect(
      startSessionRuntime({ AMA_RUNTIME_MODE: 'live', SANDBOX: {} } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { instructions: 'Test runtime' },
        environmentSnapshot: { runtimeImage: { image: 'ama-tool-executor' } },
        mcpSnapshot: { connectors: ['github'] },
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
  })

  it('stops the configured executor backend for a sandbox', async () => {
    await stopSessionRuntime({ AMA_RUNTIME_MODE: 'test' } as Env, 'sandbox_123')

    expect(toolExecutorMock).toHaveBeenCalledTimes(1)
    expect(mockExecutor.stop).toHaveBeenCalledWith('sandbox_123')
  })
})
