import { readFileSync } from 'node:fs'
import '@github/copilot/sdk'
import type { SessionEvent } from '@github/copilot-sdk'
import { approveAll, CopilotClient } from '@github/copilot-sdk'
import { runtimeError, runtimeEvent, textMessage, toolEnd, toolStart, usageEvent } from '../events/ama'
import { agentSystemPrompt, type AmaRuntimeEvent, type RuntimeProvider, type RuntimeProviderHandle, type RuntimeProviderRequest } from '../protocol'

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

type CopilotState = {
  pendingTools: Map<string, { toolName: string; args: Record<string, unknown> }>
}

function normalizeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'bash':
      return { toolName: 'sandbox.exec', args }
    case 'read':
    case 'view':
      return { toolName: 'sandbox.read', args: { path: args.path ?? args.file_path } }
    case 'write':
    case 'create':
      return { toolName: 'sandbox.write', args: { path: args.path ?? args.file_path, content: args.file_text ?? args.content } }
    default:
      return { toolName: name, args }
  }
}

function sdkEnv(request: RuntimeProviderRequest) {
  const home =
    typeof request.env.AMA_RUNTIME_BRIDGE_HOST_HOME === 'string' && request.env.AMA_RUNTIME_BRIDGE_HOST_HOME
      ? request.env.AMA_RUNTIME_BRIDGE_HOST_HOME
      : undefined
  return {
    ...request.env,
    ...(home ? { HOME: home, AMA_RUNTIME_BRIDGE_SESSION_HOME: request.env.HOME } : {}),
  }
}

function* mapCopilotEvent(event: SessionEvent, state: CopilotState): Generator<AmaRuntimeEvent> {
  switch (event.type) {
    case 'assistant.turn_start':
      yield runtimeEvent('turn_start')
      return
    case 'assistant.reasoning':
      if (event.data.content) yield runtimeEvent('runtime.output', { stream: 'reasoning', content: event.data.content })
      return
    case 'assistant.message':
      if (event.data.content) yield runtimeEvent('message_end', { message: textMessage('assistant', event.data.content) })
      for (const request of event.data.toolRequests ?? []) {
        const normalized = normalizeTool(request.name, objectValue(request.arguments))
        state.pendingTools.set(request.toolCallId, normalized)
        yield toolStart(request.toolCallId, normalized.toolName, normalized.args)
      }
      return
    case 'tool.execution_complete': {
      const pending = state.pendingTools.get(event.data.toolCallId)
      state.pendingTools.delete(event.data.toolCallId)
      yield toolEnd(
        event.data.toolCallId,
        pending?.toolName ?? 'tool',
        pending?.args ?? {},
        event.data.result?.content ?? event.data.result,
        !event.data.success,
      )
      return
    }
    case 'session.idle':
      yield runtimeEvent('turn_end', { message: { role: 'assistant', content: [], timestamp: Date.now() }, toolResults: [] })
      return
    case 'session.error':
      yield runtimeError(String(event.data.message ?? 'Copilot session error'), 'copilot_error', event.data)
      return
    default:
      yield runtimeEvent('runtime.metadata', { data: event as unknown as Record<string, unknown> })
  }
}

export const copilotProvider: RuntimeProvider = {
  name: 'copilot',
  async execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    const systemPrompt =
      typeof request.runtimeConfig?.systemPromptFile === 'string'
        ? readFileSync(request.runtimeConfig.systemPromptFile, 'utf8')
        : agentSystemPrompt(request)
    const client = new CopilotClient({ cwd: request.cwd, env: sdkEnv(request), useLoggedInUser: true })
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
        for (const mapped of mapCopilotEvent(event as SessionEvent, state)) queue.push(mapped)
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
}
