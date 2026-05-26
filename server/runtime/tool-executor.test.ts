import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { CloudflareSandboxToolExecutor, TestToolExecutor, toolExecutor } from './tool-executor'

const { getSandboxMock, sandboxMock } = vi.hoisted(() => {
  const sandboxMock = {
    exec: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    destroy: vi.fn(),
  }
  return {
    sandboxMock,
    getSandboxMock: vi.fn(() => sandboxMock),
  }
})

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: getSandboxMock,
}))

describe('tool-executor', () => {
  beforeEach(() => {
    getSandboxMock.mockClear()
    sandboxMock.exec.mockReset()
    sandboxMock.readFile.mockReset()
    sandboxMock.writeFile.mockReset()
    sandboxMock.destroy.mockReset()
  })

  it('uses the test executor when AMA runtime mode is test', () => {
    expect(toolExecutor({ AMA_RUNTIME_MODE: 'test' } as Env)).toBeInstanceOf(TestToolExecutor)
  })

  it('uses the Cloudflare Sandbox executor outside test mode', () => {
    expect(toolExecutor({ AMA_RUNTIME_MODE: 'live' } as Env)).toBeInstanceOf(CloudflareSandboxToolExecutor)
  })

  it('echoes supplied tool output, error, and duration in test mode', async () => {
    const executor = new TestToolExecutor()

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        input: {
          output: { stdout: 'ok' },
          error: { message: 'failed' },
          durationMs: 9,
        },
      }),
    ).resolves.toEqual({
      toolCallId: 'call_1',
      toolName: 'sandbox.exec',
      output: { stdout: 'ok' },
      error: { message: 'failed' },
      durationMs: 9,
    })
  })

  it('defaults missing test-mode tool result fields safely', async () => {
    const executor = new TestToolExecutor()

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        input: {},
      }),
    ).resolves.toEqual({
      toolCallId: 'call_1',
      toolName: 'sandbox.exec',
      output: {},
      error: null,
      durationMs: 0,
    })
  })

  it('executes sandbox commands in /workspace through Cloudflare Sandbox', async () => {
    sandboxMock.exec.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_1',
        toolName: 'sandbox.exec',
        input: { command: 'git status' },
      }),
    ).resolves.toMatchObject({
      toolCallId: 'call_1',
      toolName: 'sandbox.exec',
      output: { stdout: 'ok', stderr: '', exitCode: 0 },
      error: null,
    })
    expect(getSandboxMock).toHaveBeenCalledWith({}, 'sandbox_123', { keepAlive: true, normalizeId: true })
    expect(sandboxMock.exec).toHaveBeenCalledWith('git status', { cwd: '/workspace' })
  })

  it('reads and writes relative workspace files through Cloudflare Sandbox', async () => {
    sandboxMock.readFile.mockResolvedValue('hello')
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'read_1',
        toolName: 'sandbox.read',
        input: { path: 'notes/todo.txt' },
      }),
    ).resolves.toMatchObject({ output: { content: 'hello' } })
    expect(sandboxMock.readFile).toHaveBeenCalledWith('/workspace/notes/todo.txt', { encoding: 'utf-8' })

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'write_1',
        toolName: 'sandbox.write',
        input: { path: 'notes/todo.txt', content: 'done' },
      }),
    ).resolves.toMatchObject({ output: { ok: true } })
    expect(sandboxMock.writeFile).toHaveBeenCalledWith('/workspace/notes/todo.txt', 'done', { encoding: 'utf-8' })
  })

  it('rejects file paths outside /workspace before calling the sandbox', async () => {
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'read_1',
        toolName: 'sandbox.read',
        input: { path: '../secret.txt' },
      }),
    ).rejects.toThrow('sandbox file paths must stay under /workspace')
    expect(sandboxMock.readFile).not.toHaveBeenCalled()
  })

  it('destroys the sandbox executor backend on stop', async () => {
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await executor.stop('sandbox_123')

    expect(sandboxMock.destroy).toHaveBeenCalledTimes(1)
  })
})
