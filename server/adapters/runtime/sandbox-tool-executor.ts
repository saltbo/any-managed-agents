import type { Env } from '../../env'
import { RuntimeTurnCancelledError } from '../../usecases/runtime/engine/errors'
import type { ToolExecutionInput, ToolExecutionResult, ToolExecutor } from '../../usecases/runtime/engine/ports'

// Worker-host adapter for the AMA turn engine ToolExecutor port: executes sandbox
// tools against the Cloudflare Sandbox (or a deterministic in-process simulator
// in test mode). The canonical port types live in the engine/contracts; re-exported
// here so existing importers keep their paths.
export type { ToolExecutionInput, ToolExecutionResult, ToolExecutor }

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

function urlFromInput(input: Record<string, unknown>) {
  const url = input.url
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new Error('sandbox.fetch requires an http(s) url')
  }
  return url
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
// Outbound fetches are bounded much tighter than commands: a stalled host
// must not consume the turn budget.
const SANDBOX_FETCH_TIMEOUT_MS = 90_000

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export class CloudflareSandboxToolExecutor implements ToolExecutor {
  constructor(private readonly env: Env) {}

  async execute(input: ToolExecutionInput, signal?: AbortSignal): Promise<ToolExecutionResult> {
    // A cancelled turn must not start a new tool call: bail before acquiring the
    // sandbox so an aborted turn never spins one up.
    if (signal?.aborted) {
      throw new RuntimeTurnCancelledError()
    }
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
    try {
      await sandbox.destroy()
    } catch {
      // Teardown idempotency: a double-stop or stopping an already-gone sandbox
      // must not throw — destroy is best-effort cleanup, not a turn outcome.
    }
  }

  private async sandbox(sandboxId: string) {
    const getSandbox = await getSandboxBinding()
    return getSandbox(this.env.SANDBOX, sandboxId, { keepAlive: true, normalizeId: true })
  }

  private async executeInSandbox(
    sandbox: Awaited<ReturnType<CloudflareSandboxToolExecutor['sandbox']>>,
    input: ToolExecutionInput,
  ) {
    // An AbortSignal cannot be passed to the Sandbox binding: it crosses a
    // Workers RPC boundary, which rejects with "AbortSignal serialization is
    // not enabled". A cancelled turn is instead handled by the pre-exec abort
    // check (no new tool calls start) plus stop() → sandbox.destroy(), which
    // tears down any in-flight command. The per-exec timeout bounds hangs.
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
    if (input.toolName === 'sandbox.fetch') {
      // Outbound network access happens from inside the sandbox so it is
      // subject to the sandbox network namespace, after the policy gate has
      // already approved the host.
      return sandboxExecOutput(
        await sandbox.exec(`curl -fsS --max-time 60 ${shellQuote(urlFromInput(input.input))}`, {
          cwd: input.cwd ?? '/workspace',
          timeout: SANDBOX_FETCH_TIMEOUT_MS,
        }),
      )
    }
    throw new Error(`Unsupported sandbox tool: ${input.toolName}`)
  }
}

// Per-sandbox simulated filesystem for AMA_RUNTIME_MODE=test: writes are
// readable back within the same sandbox, and stopping the sandbox destroys
// its state — mirroring the one-sandbox-per-session lifecycle.
const simulatedSandboxFiles = new Map<string, Map<string, string>>()

function simulatedSandboxFs(sandboxId: string) {
  let files = simulatedSandboxFiles.get(sandboxId)
  if (!files) {
    files = new Map()
    simulatedSandboxFiles.set(sandboxId, files)
  }
  return files
}

function simulatedExecOutput(command: string) {
  const echo = command.match(/^echo\s+(.+)$/)
  return {
    stdout: echo?.[1] ?? `simulated sandbox exec: ${command}`,
    stderr: '',
    exitCode: 0,
  }
}

export class TestToolExecutor implements ToolExecutor {
  async execute(input: ToolExecutionInput, signal?: AbortSignal): Promise<ToolExecutionResult> {
    // Parity with the cloud executor: a cancelled turn must not start a new tool
    // call. Existing callers pass no signal, so simulation behavior is unchanged.
    if (signal?.aborted) {
      throw new RuntimeTurnCancelledError()
    }
    if (
      input.toolName !== 'sandbox.exec' &&
      input.toolName !== 'sandbox.read' &&
      input.toolName !== 'sandbox.write' &&
      input.toolName !== 'sandbox.fetch'
    ) {
      throw new Error(`Unsupported sandbox tool: ${input.toolName}`)
    }
    const startedAt = Date.now()
    const providedOutput =
      input.input.output && typeof input.input.output === 'object'
        ? (input.input.output as Record<string, unknown>)
        : null
    const output = providedOutput ?? this.simulate(input)
    return {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      output,
      error:
        input.input.error && typeof input.input.error === 'object'
          ? (input.input.error as Record<string, unknown>)
          : null,
      durationMs:
        typeof input.input.durationMs === 'number'
          ? input.input.durationMs
          : providedOutput || Object.keys(output).length === 0
            ? 0
            : Math.max(1, Date.now() - startedAt),
    }
  }

  async stop(sandboxId: string) {
    simulatedSandboxFiles.delete(sandboxId)
  }

  // Deterministic sandbox behavior for callers that submit real tool inputs
  // instead of pre-baked outputs: commands produce bounded stdio, file writes
  // are readable back per sandbox, and fetches resolve without leaving the
  // test process.
  private simulate(input: ToolExecutionInput): Record<string, unknown> {
    if (input.toolName === 'sandbox.exec') {
      return typeof input.input.command === 'string' ? simulatedExecOutput(input.input.command) : {}
    }
    if (input.toolName === 'sandbox.write') {
      if (typeof input.input.path !== 'string') {
        return {}
      }
      const path = filePathFromInput(input.input)
      const content = textFromInput(input.input)
      simulatedSandboxFs(input.sandboxId).set(path, content)
      return { ok: true, path, bytes: content.length }
    }
    if (input.toolName === 'sandbox.read') {
      if (typeof input.input.path !== 'string') {
        return {}
      }
      const path = filePathFromInput(input.input)
      const content = simulatedSandboxFs(input.sandboxId).get(path)
      if (content === undefined) {
        throw new Error(`Sandbox file not found: ${path}`)
      }
      return { content, path }
    }
    if (typeof input.input.url !== 'string' && typeof input.input.host !== 'string') {
      return {}
    }
    const url = typeof input.input.url === 'string' ? urlFromInput(input.input) : null
    const host = typeof input.input.host === 'string' ? input.input.host : url ? new URL(url).hostname : null
    return {
      status: 200,
      host,
      ...(url ? { url } : {}),
      content: `simulated fetch ${host ?? 'unknown-host'} ok`,
    }
  }
}

export function toolExecutor(env: Env): ToolExecutor {
  return env.AMA_RUNTIME_MODE === 'test' ? new TestToolExecutor() : new CloudflareSandboxToolExecutor(env)
}
