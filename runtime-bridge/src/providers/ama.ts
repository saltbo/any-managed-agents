import { exec as execCallback } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { AssistantMessage, Context, Model, ToolCall, Usage } from '@earendil-works/pi-ai'
import { isRuntimeTurnCancelled, ProviderCallError, RuntimeTurnCancelledError } from '../../../runtime-core/errors'
import type {
  ModelClient,
  RuntimeEventSink,
  ToolExecutionInput,
  ToolExecutionResult,
  ToolExecutor,
} from '../../../runtime-core/ports'
import { ZERO_USAGE, assistantMessage, runTurn, runtimeMessagesFromEvents } from '../../../runtime-core/turn-engine'
import { canonicalAmaSessionEventFromRuntimeEvent } from '../../../shared/session-events'
import { runtimeError } from '../events/ama'
import {
  type AmaRuntimeEvent,
  createAsyncPushQueue,
  type RuntimeProvider,
  type RuntimeProviderHandle,
  type RuntimeProviderRequest,
} from '../protocol'

// The AMA runtime running on the self-hosted runner. It executes the EXACT same
// turn engine as the cloud (runtime-core/turn-engine), proving "one core, two
// hosts": only the ports differ. Here the model egress is an OpenAI-compatible
// HTTP call to the session's configured provider, the tool executor runs against
// the local workspace, and policy is allow-all (the cloud control plane governs
// runner sessions). The engine's pi-agent-core events are canonicalized through
// the same shared mapper the cloud uses, then streamed back over the bridge.

const exec = promisify(execCallback)
const EXEC_TIMEOUT_MS = 10 * 60 * 1000

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) =>
      item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item
        ? String((item as { text: unknown }).text)
        : '',
    )
    .join('')
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  if (typeof value === 'object') return value as Record<string, unknown>
  return {}
}

// ── OpenAI-compatible wire mapping (the runner's provider egress) ─────────────

function toOpenAiMessages(context: Context) {
  const messages: Record<string, unknown>[] = []
  const system = context.systemPrompt
  if (typeof system === 'string' && system) {
    messages.push({ role: 'system', content: system })
  }
  for (const message of context.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: textContent(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : []
      const text =
        typeof message.content === 'string'
          ? message.content
          : content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')
      const toolCalls = content
        .filter((block): block is ToolCall => block.type === 'toolCall')
        .map((block) => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.arguments) },
        }))
      messages.push({ role: 'assistant', content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
      continue
    }
    messages.push({
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.toolName,
      content: textContent(message.content),
    })
  }
  return messages
}

function toOpenAiTools(context: Context) {
  return (context.tools ?? []).map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

function openAiUsage(raw: Record<string, unknown> | null): Usage {
  const usage = raw && typeof raw.usage === 'object' ? (raw.usage as Record<string, unknown>) : null
  const num = (value: unknown) => (typeof value === 'number' ? value : 0)
  if (!usage) return ZERO_USAGE
  return {
    input: num(usage.prompt_tokens),
    output: num(usage.completion_tokens),
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: num(usage.total_tokens),
    cost: ZERO_USAGE.cost,
  }
}

function parseOpenAiResponse(model: Model<string>, raw: unknown): AssistantMessage {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const choice =
    Array.isArray(record?.choices) && record.choices[0] && typeof record.choices[0] === 'object'
      ? (record.choices[0] as Record<string, unknown>)
      : null
  const message =
    choice?.message && typeof choice.message === 'object' ? (choice.message as Record<string, unknown>) : null
  const content: AssistantMessage['content'] = []
  const text = textContent(message?.content ?? record?.response ?? record?.text ?? raw)
  if (text) content.push({ type: 'text', text })
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
  for (const [index, toolCall] of toolCalls.entries()) {
    if (!toolCall || typeof toolCall !== 'object') continue
    const call = toolCall as Record<string, unknown>
    const fn = call.function && typeof call.function === 'object' ? (call.function as Record<string, unknown>) : {}
    const name = typeof fn.name === 'string' ? fn.name : typeof call.name === 'string' ? call.name : null
    if (!name) continue
    content.push({
      type: 'toolCall',
      id: typeof call.id === 'string' ? call.id : `tool_${index + 1}`,
      name,
      arguments: parseToolArguments(fn.arguments ?? call.arguments),
    })
  }
  return assistantMessage(
    model,
    content.length ? content : [{ type: 'text', text: '' }],
    toolCalls.length ? 'toolUse' : 'stop',
    openAiUsage(record),
  )
}

function buildModel(request: RuntimeProviderRequest): Model<string> {
  const provider = request.provider ?? 'openai'
  const id = request.model ?? 'gpt-4o-mini'
  return {
    id,
    name: id,
    api: 'openai-compatible',
    provider,
    baseUrl: request.env.AMA_PROVIDER_BASE_URL ?? request.env.OPENAI_BASE_URL ?? '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  }
}

function openAiModelClient(request: RuntimeProviderRequest): ModelClient {
  const baseUrl = (
    request.env.AMA_PROVIDER_BASE_URL ||
    request.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1'
  ).replace(/\/$/, '')
  const apiKey = request.env.AMA_PROVIDER_API_KEY || request.env.OPENAI_API_KEY || ''
  return {
    async complete(model, context, signal) {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: model.id,
            messages: toOpenAiMessages(context),
            tools: toOpenAiTools(context),
          }),
          ...(signal ? { signal } : {}),
        })
      } catch (error) {
        throw new ProviderCallError({
          message: error instanceof Error ? error.message : 'Model request failed',
          category: 'network',
          retryable: true,
        })
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new ProviderCallError({
          message: `Provider responded ${response.status}`,
          category: response.status === 429 ? 'rate_limit' : 'provider_error',
          retryable: response.status >= 500 || response.status === 429,
        })
      }
      return parseOpenAiResponse(model, await response.json())
    },
  }
}

// ── Local workspace tool executor (the runner's sandbox port) ─────────────────

function resolveWorkspacePath(workdir: string, raw: unknown): string {
  if (typeof raw !== 'string' || !raw) {
    throw new Error('sandbox tool requires a non-empty path')
  }
  const resolved = isAbsolute(raw) ? resolve(raw) : resolve(workdir, raw)
  const rel = relative(resolve(workdir), resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('sandbox path escapes the workspace')
  }
  return resolved
}

async function runLocalTool(workdir: string, input: ToolExecutionInput): Promise<Record<string, unknown>> {
  const args = input.input
  switch (input.toolName) {
    case 'sandbox.exec': {
      const command = args.command
      if (typeof command !== 'string' || !command.trim()) {
        throw new Error('sandbox.exec requires a non-empty command')
      }
      const { stdout, stderr } = await exec(command, { cwd: workdir, timeout: EXEC_TIMEOUT_MS, encoding: 'utf8' })
      return { stdout, stderr, exitCode: 0 }
    }
    case 'sandbox.read': {
      const path = resolveWorkspacePath(workdir, args.path)
      return { content: await readFile(path, 'utf8') }
    }
    case 'sandbox.write': {
      const path = resolveWorkspacePath(workdir, args.path)
      const content = typeof args.content === 'string' ? args.content : ''
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
      return { bytesWritten: Buffer.byteLength(content, 'utf8') }
    }
    case 'sandbox.fetch': {
      const url = args.url
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new Error('sandbox.fetch requires an http(s) URL')
      }
      const response = await fetch(url)
      return { status: response.status, content: await response.text() }
    }
    default:
      throw new Error(`Unsupported sandbox tool: ${input.toolName}`)
  }
}

function localToolExecutor(workdir: string): ToolExecutor {
  return {
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = Date.now()
      try {
        const output = await runLocalTool(workdir, input)
        return { toolCallId: input.toolCallId, toolName: input.toolName, output, error: null, durationMs: Date.now() - startedAt }
      } catch (error) {
        return {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          output: {},
          error: { message: error instanceof Error ? error.message : 'Tool execution failed' },
          durationMs: Date.now() - startedAt,
        }
      }
    },
  }
}

export const amaProvider: RuntimeProvider = {
  name: 'ama',
  async execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    const outQueue = createAsyncPushQueue<AmaRuntimeEvent>()
    const promptQueue = createAsyncPushQueue<string>()
    // Raw pi-agent-core events, kept so a continuation turn rebuilds the
    // transcript (the same logic the cloud uses against persisted events).
    const rawEvents: Array<{ type?: string; payload: Record<string, unknown> }> = []
    const abortController = new AbortController()
    const model = buildModel(request)

    const sink: RuntimeEventSink = {
      async emit(event, metadata) {
        rawEvents.push(typeof event.type === 'string' ? { type: event.type, payload: event } : { payload: event })
        const canonical = canonicalAmaSessionEventFromRuntimeEvent(event, metadata ?? { source: 'ama-runner-runtime' })
        outQueue.push({ type: canonical.type, payload: canonical.payload, metadata: canonical.metadata })
      },
    }
    const turnBase = {
      sessionId: request.sessionId,
      sandboxId: request.sessionId,
      model,
      providerLabel: request.provider ?? model.provider,
      modelLabel: model.id,
      agentSnapshot: request.agentSnapshot ?? {},
      sink,
      // The cloud control plane governs runner sessions; the local turn allows
      // every tool call and surfaces them as events for cloud-side inspection.
      policy: { approve: async () => ({ allowed: true }) },
      toolResults: { resolve: async () => null },
      liveness: {
        async ensureActive() {
          if (abortController.signal.aborted) {
            throw new RuntimeTurnCancelledError()
          }
        },
      },
      executor: localToolExecutor(request.cwd),
      modelClient: openAiModelClient(request),
    }

    // Run the initial prompt, then keep running a continuation turn for each
    // mid-run prompt the runner injects (RegisterPromptSender → send), until the
    // session is aborted. Continuations resume from the rebuilt transcript.
    ;(async () => {
      try {
        await runTurn({ ...turnBase, prompt: request.prompt })
        for await (const prompt of promptQueue.values) {
          if (abortController.signal.aborted) {
            break
          }
          await runTurn({ ...turnBase, prompt, messages: runtimeMessagesFromEvents(rawEvents) })
        }
      } catch (error) {
        if (!isRuntimeTurnCancelled(error)) {
          outQueue.push(runtimeError(error instanceof Error ? error.message : 'AMA runtime failed', 'runtime_failed'))
        }
      } finally {
        outQueue.end()
      }
    })()

    return {
      events: outQueue.values,
      async abort() {
        abortController.abort()
        promptQueue.end()
      },
      async send(message: string) {
        promptQueue.push(message)
      },
      getResumeToken() {
        return undefined
      },
    }
  },
}
