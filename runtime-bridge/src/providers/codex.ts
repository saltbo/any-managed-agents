import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Codex, type ThreadEvent } from '@openai/codex-sdk'
import { runtimeError, runtimeEvent, textMessage, toolEnd, toolStart, usageEvent } from '../events/ama'
import {
  agentSystemPrompt,
  type AmaRuntimeEvent,
  type RuntimeProvider,
  type RuntimeProviderHandle,
  type RuntimeProviderRequest,
  type RuntimeUsageWindow,
} from '../protocol'

const CODEX_USAGE_API = 'https://chatgpt.com/backend-api/wham/usage'

function homeFromEnv(env: Record<string, string>): string | undefined {
  return typeof env.AMA_RUNTIME_BRIDGE_HOST_HOME === 'string' && env.AMA_RUNTIME_BRIDGE_HOST_HOME ? env.AMA_RUNTIME_BRIDGE_HOST_HOME : undefined
}

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

function hostHome(request: RuntimeProviderRequest): string | undefined {
  return homeFromEnv(request.env)
}

function sdkEnv(request: RuntimeProviderRequest) {
  const home = hostHome(request)
  return {
    ...request.env,
    ...(home ? { HOME: home, AMA_RUNTIME_BRIDGE_SESSION_HOME: request.env.HOME } : {}),
  }
}

function readAccessToken(request: RuntimeProviderRequest): string | null {
  return codexAccessToken(hostHome(request))
}

function resolveCodexPath(): string | undefined {
  try {
    return execSync('which codex', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch {
    return undefined
  }
}

function resolveModel(request: RuntimeProviderRequest): string | undefined {
  if (!request.model) return readAccessToken(request) ? undefined : 'o3'
  if (readAccessToken(request) && !request.env.OPENAI_API_KEY) return undefined
  return request.model
}

function itemId(item: Record<string, unknown>) {
  return typeof item.id === 'string' && item.id ? item.id : `codex-tool-${Date.now()}`
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function codexToolShape(item: Record<string, unknown>): { toolName: string; args: Record<string, unknown> } | null {
  switch (item.type) {
    case 'command_execution':
      return { toolName: 'sandbox.exec', args: { command: item.command } }
    case 'file_change':
      return {
        toolName: 'workspace.edit',
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
      return { toolName: 'web.search', args: { query: item.query } }
    default:
      return null
  }
}

function toolResult(item: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const key of ['stdout', 'stderr', 'output', 'result', 'exit_code', 'exitCode']) {
    if (key in item) result[key] = item[key]
  }
  return Object.keys(result).length ? result : { item }
}

function usagePayload(usage: Record<string, unknown>) {
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? 0)
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? 0)
  const cachedInputTokens = Number(usage.cached_input_tokens ?? usage.cachedInputTokens ?? 0)
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens),
  }
}

function* mapThreadEvent(event: ThreadEvent): Generator<AmaRuntimeEvent> {
  switch (event.type) {
    case 'thread.started':
      yield runtimeEvent('runtime.metadata', {
        data: { stage: 'thread_started', status: 'running', threadId: event.thread_id },
      })
      return
    case 'turn.started':
      yield runtimeEvent('turn_start')
      return
    case 'item.started': {
      const item = objectValue(event.item)
      const shape = codexToolShape(item)
      if (shape) yield toolStart(itemId(item), shape.toolName, shape.args)
      return
    }
    case 'item.completed': {
      const item = objectValue(event.item)
      if (item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
        yield runtimeEvent('message_end', { message: textMessage('assistant', item.text, typeof item.id === 'string' ? item.id : undefined) })
        return
      }
      if (item.type === 'reasoning' && typeof item.text === 'string' && item.text) {
        yield runtimeEvent('runtime.output', { stream: 'reasoning', content: item.text })
        return
      }
      const shape = codexToolShape(item)
      if (shape) yield toolEnd(itemId(item), shape.toolName, shape.args, toolResult(item), Boolean(item.error))
      return
    }
    case 'turn.completed':
      yield usageEvent(usagePayload(objectValue(event.usage)))
      yield runtimeEvent('turn_end', { message: { role: 'assistant', content: [], timestamp: Date.now() }, toolResults: [] })
      return
    case 'turn.failed':
      yield runtimeError(String(objectValue(event.error).message ?? JSON.stringify(event)), String(objectValue(event.error).code ?? 'codex_error'), event)
      return
    case 'error':
      yield runtimeError(String(event.message ?? JSON.stringify(event)), 'codex_error', event)
      return
    default:
      yield runtimeEvent('runtime.metadata', { data: { unmappedEvent: event } })
  }
}

export const codexProvider: RuntimeProvider = {
  name: 'codex',
  async execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    let resumeToken = request.resumeToken
    const abortController = new AbortController()
    const codexPathOverride = resolveCodexPath()
    const codex = new Codex({ env: sdkEnv(request), ...(codexPathOverride ? { codexPathOverride } : {}) })
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
    const systemPrompt = agentSystemPrompt(request)
    const prompt = systemPrompt ? `${systemPrompt}\n\nUser task:\n${request.prompt}` : request.prompt
    const streamed = await thread.runStreamed(prompt, { signal: abortController.signal })
    const events = (async function* () {
      for await (const event of streamed.events) {
        if (event.type === 'thread.started') resumeToken = event.thread_id
        yield* mapThreadEvent(event)
      }
    })()
    return {
      events,
      async abort() {
        abortController.abort()
      },
      async send() {
        throw new Error('Codex multi-turn send is not implemented')
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
    const home = homeFromEnv(env) ?? process.env.HOME
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
    const token = codexAccessToken(homeFromEnv(env))
    if (!token) return null
    const res = await fetch(CODEX_USAGE_API, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    type RateLimitWindow = { used_percent: number; reset_at: number; limit_window_seconds: number }
    const data = (await res.json()) as { rate_limit?: { primary_window?: RateLimitWindow; secondary_window?: RateLimitWindow } }
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
