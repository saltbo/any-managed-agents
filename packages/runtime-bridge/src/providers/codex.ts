import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolResult } from '@ama/runtime-contracts/session-events'
import { Codex, type ThreadEvent } from '@openai/codex-sdk'
import {
  messageEvent,
  randomId,
  reasoningBlock,
  runtimeError,
  runtimeEvent,
  textMessage,
  toolCallBlock,
  toolResultMessage,
  turnEnd,
} from '../events/ama'
import {
  type AmaRuntimeEvent,
  agentSystemPrompt,
  type RuntimeProvider,
  type RuntimeProviderHandle,
  type RuntimeProviderRequest,
  type RuntimeUsageWindow,
} from '../protocol'
import { arrayValue, hostHome, objectValue, resolveCliPath, sdkEnv } from './cli-host'

const CODEX_USAGE_API = 'https://chatgpt.com/backend-api/wham/usage'

function codexAccessToken(home: string | undefined): string | null {
  if (!home) return null
  try {
    const auth = JSON.parse(readFileSync(join(home, '.codex', 'auth.json'), 'utf8')) as {
      tokens?: { access_token?: string }
      access_token?: string
    }
    return auth.tokens?.access_token ?? auth.access_token ?? null
  } catch {
    return null
  }
}

function readAccessToken(request: RuntimeProviderRequest): string | null {
  return codexAccessToken(hostHome(request.env))
}

function resolveModel(request: RuntimeProviderRequest): string | undefined {
  if (!request.model) return readAccessToken(request) ? undefined : 'o3'
  if (readAccessToken(request) && !request.env.OPENAI_API_KEY) return undefined
  return request.model
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function itemId(item: Record<string, unknown>) {
  return typeof item.id === 'string' && item.id ? item.id : null
}

function codexToolShape(item: Record<string, unknown>): { toolName: string; args: Record<string, unknown> } | null {
  switch (item.type) {
    case 'command_execution':
      return { toolName: 'bash', args: { command: item.command } }
    case 'file_change':
      return {
        toolName: 'edit',
        args: {
          changes: item.changes,
          files: arrayValue(item.changes)
            .map((change) => objectValue(change))
            .map((change) => [change.kind, change.path].filter(Boolean).join(' '))
            .filter(Boolean),
        },
      }
    case 'mcp_tool_call':
      return { toolName: typeof item.name === 'string' ? item.name : 'mcp_tool', args: objectValue(item.arguments) }
    case 'web_search':
      return { toolName: 'web_search', args: { query: item.query } }
    default:
      return null
  }
}

function toolResult(item: Record<string, unknown>): ToolResult {
  const stdout = typeof item.stdout === 'string' ? item.stdout : ''
  const stderr = typeof item.stderr === 'string' ? item.stderr : ''
  const output =
    typeof item.output === 'string'
      ? item.output
      : typeof item.aggregated_output === 'string'
        ? item.aggregated_output
        : [stdout, stderr].filter(Boolean).join('\n')
  return {
    content: output ? [{ type: 'text', text: output }] : [],
    structuredContent: codexToolStructuredContent(item),
    ...(typeof item.exit_code === 'number'
      ? { exitCode: item.exit_code }
      : typeof item.exitCode === 'number'
        ? { exitCode: item.exitCode }
        : {}),
  }
}

function codexToolStructuredContent(item: Record<string, unknown>) {
  const structured = Object.fromEntries(
    Object.entries({
      result: item.result,
      stdout: item.stdout,
      stderr: item.stderr,
      output: item.output,
      aggregatedOutput: item.aggregated_output,
    }).filter(([, value]) => value !== undefined && value !== ''),
  )
  return Object.keys(structured).length > 0 ? structured : undefined
}

class CodexEventMapper {
  private turnIndex = 0
  private readonly toolCallIds = new Map<string, string>();

  *map(event: ThreadEvent): Generator<AmaRuntimeEvent> {
    switch (event.type) {
      case 'thread.started':
        yield runtimeEvent('runtime.started')
        return
      case 'turn.started':
        this.turnIndex += 1
        yield runtimeEvent('turn.started')
        return
      case 'item.started': {
        const item = objectValue(event.item)
        const shape = codexToolShape(item)
        const id = itemId(item)
        if (shape && id) {
          yield messageEvent({
            id: randomId('msg'),
            role: 'assistant',
            content: [toolCallBlock({ id: this.toolCallId(id), name: shape.toolName, input: shape.args })],
          })
        }
        return
      }
      case 'item.completed': {
        const item = objectValue(event.item)
        if (item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
          yield runtimeEvent('message.completed', {
            message: textMessage('assistant', item.text, typeof item.id === 'string' ? item.id : undefined),
          })
          return
        }
        if (item.type === 'reasoning' && typeof item.text === 'string' && item.text) {
          yield messageEvent({
            id: typeof item.id === 'string' ? item.id : randomId('msg'),
            role: 'assistant',
            content: [reasoningBlock(item.text)],
          })
          return
        }
        const shape = codexToolShape(item)
        const id = itemId(item)
        if (shape && id)
          yield messageEvent(toolResultMessage(this.toolCallId(id), toolResult(item), Boolean(item.error)))
        return
      }
      case 'turn.completed': {
        // TODO(codex-usage): @openai/codex-sdk 0.142.5 exposes token usage here
        // but not the actual model used for the turn. The raw Codex JSONL has it
        // under turn_context.payload.model. Do not emit usage.recorded until the
        // bridge can read that confirmed source or the SDK exposes an equivalent
        // field; falling back to request.model would misattribute sessions where
        // Codex resolves or switches models itself.
        yield turnEnd()
        return
      }
      case 'turn.failed':
        yield runtimeError(
          String(objectValue(event.error).message ?? JSON.stringify(event)),
          String(objectValue(event.error).code ?? 'codex_error'),
          event,
        )
        return
      case 'error':
        yield runtimeError(String(event.message ?? JSON.stringify(event)), 'codex_error', event)
        return
      default:
        return
    }
  }

  private toolCallId(providerToolCallId: string) {
    const key = `${this.turnIndex}:${providerToolCallId}`
    const existing = this.toolCallIds.get(key)
    if (existing) return existing
    const id = `codex:${key}`
    this.toolCallIds.set(key, id)
    return id
  }
}

export const codexProvider: RuntimeProvider = {
  name: 'codex',
  binary: 'codex',
  fallbackModels: ['gpt-5.3-codex'],
  async execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    let resumeToken = request.resumeToken
    const abortController = new AbortController()
    let stopped = false
    const queuedPrompts: string[] = [request.prompt]
    let wakePrompt: (() => void) | undefined
    const codexPathOverride = resolveCliPath('codex')
    const systemPrompt = agentSystemPrompt(request)
    const codex = new Codex({
      env: sdkEnv(request),
      // Managed sessions must not inherit the host user's personal Codex Apps
      // connectors (e.g. the GitHub connector creates PRs as the host user
      // instead of with the session-scoped git credential).
      config: { features: { apps: false }, ...(systemPrompt ? { developer_instructions: systemPrompt } : {}) },
      ...(codexPathOverride ? { codexPathOverride } : {}),
    })
    const model = resolveModel(request)
    const threadOptions = {
      workingDirectory: request.cwd,
      skipGitRepoCheck: true,
      sandboxMode: 'danger-full-access' as const,
      approvalPolicy: 'never' as const,
      ...(model ? { model } : {}),
    }
    const thread =
      request.resume && resumeToken ? codex.resumeThread(resumeToken, threadOptions) : codex.startThread(threadOptions)
    const idleKeepAliveMs = positiveNumber(request.runtimeConfig?.codexIdleKeepAliveMs)
    const mapper = new CodexEventMapper()
    const nextPrompt = async (): Promise<string | undefined> => {
      const queued = queuedPrompts.shift()
      if (queued !== undefined) return queued
      if (!idleKeepAliveMs || stopped) return undefined
      return await new Promise<string | undefined>((resolve) => {
        const timer = setTimeout(() => {
          wakePrompt = undefined
          resolve(undefined)
        }, idleKeepAliveMs)
        wakePrompt = () => {
          clearTimeout(timer)
          wakePrompt = undefined
          resolve(queuedPrompts.shift())
        }
      })
    }
    const events = (async function* () {
      while (!stopped) {
        const prompt = await nextPrompt()
        if (prompt === undefined) return
        const streamed = await thread.runStreamed(prompt, { signal: abortController.signal })
        for await (const event of streamed.events) {
          if (event.type === 'thread.started') resumeToken = event.thread_id
          yield* mapper.map(event)
        }
      }
    })()
    return {
      events,
      async abort() {
        stopped = true
        wakePrompt?.()
        abortController.abort()
      },
      async send(message: string) {
        if (stopped) throw new Error('Codex runtime is stopped')
        queuedPrompts.push(message)
        wakePrompt?.()
      },
      getResumeToken() {
        return resumeToken
      },
    }
  },

  // Enumerate the models the host Codex login can serve from the CLI's own
  // models cache (~/.codex/models_cache.json, populated when Codex runs).
  // There is no SDK listing call; the cache is the host's model universe.
  async listModels({ env }): Promise<string[] | null> {
    const home = hostHome(env) ?? process.env.HOME
    if (!home) return null
    let raw: string
    try {
      raw = readFileSync(join(home, '.codex', 'models_cache.json'), 'utf8')
    } catch {
      return null
    }
    const data = JSON.parse(raw) as { models?: Array<{ slug?: string; visibility?: string; priority?: number }> }
    const models = (data.models ?? [])
      .filter((model) => typeof model.slug === 'string' && model.slug && model.visibility !== 'hide')
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))
      .map((model) => model.slug as string)
    return models.length > 0 ? models : null
  },

  async fetchUsage({ env }): Promise<RuntimeUsageWindow[] | null> {
    const token = codexAccessToken(hostHome(env))
    if (!token) return null
    const res = await fetch(CODEX_USAGE_API, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    type RateLimitWindow = { used_percent: number; reset_at: number; limit_window_seconds: number }
    const data = (await res.json()) as {
      rate_limit?: { primary_window?: RateLimitWindow; secondary_window?: RateLimitWindow }
    }
    const windowLabel = (secs: number) => (secs <= 18000 ? '5-Hour' : 'Weekly')
    const windows: RuntimeUsageWindow[] = []
    for (const window of [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]) {
      if (!window) continue
      windows.push({
        label: windowLabel(window.limit_window_seconds),
        utilization: window.used_percent,
        resetsAt: new Date(window.reset_at * 1000).toISOString(),
      })
    }
    return windows
  },
}
