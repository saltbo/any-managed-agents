import { execSync } from 'node:child_process'
import '@github/copilot/sdk'
import { approveAll, CopilotClient } from '@github/copilot-sdk'
import { reasoning, runtimeError, runtimeEvent, textMessage, toolEnd, toolStart, turnEnd } from '../events/ama'
import {
  type AmaRuntimeEvent,
  agentSystemPrompt,
  type RuntimeProvider,
  type RuntimeProviderHandle,
  type RuntimeProviderRequest,
  type RuntimeUsageWindow,
} from '../protocol'
import { hostHome, objectValue, resolveCliPath, sdkEnv } from './cli-host'

const COPILOT_USER_API = 'https://api.github.com/copilot_internal/user'

function readGhToken(home: string | undefined): string | null {
  try {
    return (
      execSync('gh auth token', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: home ? { ...process.env, HOME: home } : process.env,
      }).trim() || null
    )
  } catch {
    return null
  }
}

type CopilotState = {
  pendingTools: Map<string, { toolName: string; args: Record<string, unknown> }>
}

type CopilotEvent = {
  type: string
  data: {
    content?: string
    message?: unknown
    toolRequests?: Array<{ name: string; arguments: unknown; toolCallId: string }>
    toolCallId?: string
    result?: { content?: unknown } | unknown
    success?: boolean
    [key: string]: unknown
  }
}

function normalizeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'bash':
      return { toolName: 'bash', args }
    case 'read':
    case 'view':
      return { toolName: 'read', args: { path: args.path ?? args.file_path } }
    case 'write':
    case 'create':
      return {
        toolName: 'write',
        args: { path: args.path ?? args.file_path, content: args.file_text ?? args.content },
      }
    default:
      return { toolName: name, args }
  }
}

function* mapCopilotEvent(event: CopilotEvent, state: CopilotState): Generator<AmaRuntimeEvent> {
  switch (event.type) {
    case 'assistant.turn.started':
      yield runtimeEvent('turn.started')
      return
    case 'assistant.reasoning':
      if (event.data.content) yield reasoning(event.data.content)
      return
    case 'assistant.message':
      if (event.data.content)
        yield runtimeEvent('message.completed', { message: textMessage('assistant', event.data.content) })
      for (const request of event.data.toolRequests ?? []) {
        const normalized = normalizeTool(request.name, objectValue(request.arguments))
        state.pendingTools.set(request.toolCallId, normalized)
        yield toolStart(request.toolCallId, normalized.toolName, normalized.args)
      }
      return
    case 'tool.execution_complete': {
      const toolCallId = typeof event.data.toolCallId === 'string' ? event.data.toolCallId : 'tool'
      const pending = state.pendingTools.get(toolCallId)
      state.pendingTools.delete(toolCallId)
      yield toolEnd(
        toolCallId,
        pending?.toolName ?? 'tool',
        pending?.args ?? {},
        copilotResultContent(event.data.result),
        !event.data.success,
      )
      return
    }
    case 'session.idle':
      yield turnEnd()
      return
    case 'session.error':
      yield runtimeError(String(event.data.message ?? 'Copilot session error'), 'copilot_error', event.data)
      return
    default:
      yield runtimeEvent('runtime.status', { data: event as unknown as Record<string, unknown> })
  }
}

function copilotResultContent(result: unknown) {
  const object = objectValue(result)
  return 'content' in object ? object.content : result
}

export const copilotProvider: RuntimeProvider = {
  name: 'copilot',
  binary: 'copilot',
  fallbackModels: ['copilot-cli'],
  async execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    const systemPrompt = agentSystemPrompt(request)
    // Without an explicit cliPath the SDK resolves @github/copilot via
    // import.meta.resolve, which throws when the bridge runs from the runner's
    // materialized temp dir (no node_modules). Point it at the host CLI instead.
    const copilotPath = resolveCliPath('copilot')
    const client = new CopilotClient({
      cwd: request.cwd,
      env: sdkEnv(request),
      useLoggedInUser: true,
      ...(copilotPath ? { cliPath: copilotPath } : {}),
    })
    await client.start()
    const sessionConfig = {
      ...(request.model ? { model: request.model } : {}),
      workingDirectory: request.cwd,
      onPermissionRequest: approveAll,
      ...(systemPrompt ? { systemMessage: { content: systemPrompt } } : {}),
    }
    const session =
      request.resume && request.resumeToken
        ? await client.resumeSession(request.resumeToken, sessionConfig)
        : await client.createSession({ sessionId: request.sessionId, ...sessionConfig })

    const queue: AmaRuntimeEvent[] = []
    let done = false
    let queueError: unknown
    let notify: (() => void) | null = null
    const state: CopilotState = { pendingTools: new Map() }
    const finish = (err?: unknown) => {
      done = true
      queueError = err
      notify?.()
    }
    const unsubscribe = session.on((event) => {
      try {
        for (const mapped of mapCopilotEvent(event as CopilotEvent, state)) queue.push(mapped)
        if (event.type === 'session.idle') finish()
        if (event.type === 'session.error') finish()
        notify?.()
      } catch (err) {
        finish(err)
      }
    })
    await session.send({ prompt: request.prompt })
    const events = (async function* () {
      try {
        while (!done || queue.length > 0) {
          while (queue.length > 0) yield queue.shift()!
          if (done) break
          await new Promise<void>((resolve) => {
            notify = resolve
          })
          notify = null
        }
        if (queueError) throw queueError
      } finally {
        unsubscribe()
        await session.disconnect().catch(() => {})
        await client.stop().catch(() => {})
      }
    })()
    return {
      events,
      async abort() {
        await session.abort().catch(() => {})
        finish()
      },
      async send(message: string) {
        await session.send({ prompt: message })
      },
      getResumeToken() {
        return session.sessionId
      },
    }
  },

  // Enumerate the models the host Copilot login can serve via the SDK's
  // listModels() (same path as the AK CLI reference).
  async listModels({ env }): Promise<string[] | null> {
    const home = hostHome(env)
    const clientEnv = { ...(process.env as Record<string, string>), ...(home ? { HOME: home } : {}) }
    const copilotPath = resolveCliPath('copilot')
    const client = new CopilotClient({
      env: clientEnv,
      useLoggedInUser: true,
      ...(copilotPath ? { cliPath: copilotPath } : {}),
    })
    await client.start()
    try {
      const models = await client.listModels()
      return models.length > 0 ? models.map((model) => model.id) : null
    } finally {
      await client.stop().catch(() => {})
    }
  },

  async fetchUsage({ env }): Promise<RuntimeUsageWindow[] | null> {
    const token = readGhToken(hostHome(env))
    if (!token) return null
    const res = await fetch(COPILOT_USER_API, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    type QuotaSnapshot = { percent_remaining: number; unlimited: boolean }
    const data = (await res.json()) as {
      quota_reset_date_utc?: string
      quota_snapshots?: Record<string, QuotaSnapshot>
    }
    const resetsAt = data.quota_reset_date_utc ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const snapshots = data.quota_snapshots ?? {}
    const QUOTA_LABELS: Record<string, string> = {
      premium_interactions: 'Premium',
      chat: 'Chat',
      completions: 'Completions',
    }
    const windows: RuntimeUsageWindow[] = []
    for (const [key, label] of Object.entries(QUOTA_LABELS)) {
      const snapshot = snapshots[key]
      if (!snapshot || snapshot.unlimited) continue
      windows.push({ label, utilization: Number((100 - snapshot.percent_remaining).toFixed(2)), resetsAt })
    }
    return windows.length > 0 ? windows : null
  },
}
