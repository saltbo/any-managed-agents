import type { Env } from '../env'

export type ToolExecutionInput = {
  sessionId: string
  sandboxId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  cwd?: string
}

export type ToolExecutionResult = {
  toolCallId: string
  toolName: string
  output: Record<string, unknown>
  error: Record<string, unknown> | null
  durationMs: number
}

export interface ToolExecutor {
  execute(input: ToolExecutionInput, signal?: AbortSignal): Promise<ToolExecutionResult>
  stop?(sandboxId: string): Promise<void>
}

function commandFromInput(input: Record<string, unknown>) {
  const command = input.command
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('sandbox.exec requires a non-empty command')
  }
  return command
}

function filePathFromInput(input: Record<string, unknown>) {
  const path = input.path
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('sandbox file operations require a non-empty path')
  }
  if (path.split('/').includes('..')) {
    throw new Error('sandbox file paths must stay under /workspace')
  }
  // Models address files both ways; accept absolute paths inside /workspace.
  if (path.startsWith('/')) {
    if (path !== '/workspace' && !path.startsWith('/workspace/')) {
      throw new Error('sandbox file paths must stay under /workspace')
    }
    return path
  }
  return `/workspace/${path}`
}

function textFromInput(input: Record<string, unknown>) {
  const content = input.content
  if (typeof content !== 'string') {
    throw new Error('sandbox.write requires string content')
  }
  return content
}

function sandboxExecOutput(value: unknown) {
  if (!value || typeof value !== 'object') {
    return { stdout: String(value ?? ''), stderr: '', exitCode: 0 }
  }
  const record = value as Record<string, unknown>
  return {
    stdout: typeof record.stdout === 'string' ? record.stdout : '',
    stderr: typeof record.stderr === 'string' ? record.stderr : '',
    exitCode: typeof record.exitCode === 'number' ? record.exitCode : 0,
  }
}

async function getSandboxBinding() {
  const { getSandbox } = await import('@cloudflare/sandbox')
  return getSandbox
}

// Parity with the self-hosted runner's per-command default (10 minutes).
const SANDBOX_EXEC_TIMEOUT_MS = 10 * 60_000

export class CloudflareSandboxToolExecutor implements ToolExecutor {
  constructor(private readonly env: Env) {}

  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const startedAt = Date.now()
    const sandbox = await this.sandbox(input.sandboxId)
    const output = await this.executeInSandbox(sandbox, input)
    return {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      output,
      error: null,
      durationMs: Date.now() - startedAt,
    }
  }

  async stop(sandboxId: string) {
    const sandbox = await this.sandbox(sandboxId)
    await sandbox.destroy()
  }

  private async sandbox(sandboxId: string) {
    const getSandbox = await getSandboxBinding()
    return getSandbox(this.env.SANDBOX, sandboxId, { keepAlive: true, normalizeId: true })
  }

  private async executeInSandbox(
    sandbox: Awaited<ReturnType<CloudflareSandboxToolExecutor['sandbox']>>,
    input: ToolExecutionInput,
  ) {
    if (input.toolName === 'sandbox.exec') {
      // Bounded: an unbounded hang (network stall, interactive prompt) would
      // otherwise consume the whole turn budget and strand the session.
      return sandboxExecOutput(
        await sandbox.exec(commandFromInput(input.input), {
          cwd: input.cwd ?? '/workspace',
          timeout: SANDBOX_EXEC_TIMEOUT_MS,
        }),
      )
    }
    if (input.toolName === 'sandbox.read') {
      return { content: await sandbox.readFile(filePathFromInput(input.input), { encoding: 'utf-8' }) }
    }
    if (input.toolName === 'sandbox.write') {
      await sandbox.writeFile(filePathFromInput(input.input), textFromInput(input.input), { encoding: 'utf-8' })
      return { ok: true }
    }
    throw new Error(`Unsupported sandbox tool: ${input.toolName}`)
  }
}

export class TestToolExecutor implements ToolExecutor {
  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    if (input.toolName !== 'sandbox.exec' && input.toolName !== 'sandbox.read' && input.toolName !== 'sandbox.write') {
      throw new Error(`Unsupported sandbox tool: ${input.toolName}`)
    }
    return {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      output:
        input.input.output && typeof input.input.output === 'object'
          ? (input.input.output as Record<string, unknown>)
          : {},
      error:
        input.input.error && typeof input.input.error === 'object'
          ? (input.input.error as Record<string, unknown>)
          : null,
      durationMs: typeof input.input.durationMs === 'number' ? input.input.durationMs : 0,
    }
  }
}

export function toolExecutor(env: Env): ToolExecutor {
  return env.AMA_RUNTIME_MODE === 'test' ? new TestToolExecutor() : new CloudflareSandboxToolExecutor(env)
}
