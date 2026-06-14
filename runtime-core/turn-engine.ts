// The AMA turn-execution core. Host-agnostic: it drives the pi-agent-core loop,
// gates tools through the policy port, emits canonical events to the sink, and
// reaches the model and the sandbox only through the ModelClient / ToolExecutor
// ports. The same code runs in the Cloudflare Worker and (Phase 3) in the
// runtime-bridge subprocess on the self-hosted runner — one core, two hosts.
import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type AgentToolResult } from '@earendil-works/pi-agent-core'
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type StreamOptions,
  type ToolCall,
  Type,
  type Usage,
} from '@earendil-works/pi-ai'
import { ProviderCallError, RuntimePolicyDeniedError, type RuntimeProviderError, RuntimeTurnCancelledError, isRuntimeTurnCancelled } from './errors'
import type {
  ModelClient,
  ToolExecutor,
  ToolPolicyGate,
  ToolResultResolver,
  TurnBudget,
  TurnEngineInput,
  TurnEngineResult,
  TurnLiveness,
} from './ports'

const EVENT_META = {
  source: 'ama-cloud-runtime',
  piCorePackage: '@earendil-works/pi-agent-core',
}

export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

export function assistantMessage(
  model: Model<string>,
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
  usage: Usage,
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  }
}

function emitAssistantMessage(stream: AssistantMessageEventStream, message: AssistantMessage) {
  stream.push({ type: 'start', partial: { ...message, content: [] } })
  const partial: AssistantMessage = { ...message, content: [] }
  for (let index = 0; index < message.content.length; index += 1) {
    const block = message.content[index]
    if (!block) {
      continue
    }
    if (block.type === 'text') {
      partial.content = [...partial.content, { type: 'text', text: '' }]
      stream.push({ type: 'text_start', contentIndex: index, partial: { ...partial } })
      ;(partial.content[index] as { type: 'text'; text: string }).text = block.text
      stream.push({ type: 'text_delta', contentIndex: index, delta: block.text, partial: { ...partial } })
      stream.push({ type: 'text_end', contentIndex: index, content: block.text, partial: { ...partial } })
      continue
    }
    if (block.type === 'toolCall') {
      partial.content = [...partial.content, { type: 'toolCall', id: block.id, name: block.name, arguments: {} }]
      stream.push({ type: 'toolcall_start', contentIndex: index, partial: { ...partial } })
      ;(partial.content[index] as ToolCall).arguments = block.arguments
      stream.push({
        type: 'toolcall_delta',
        contentIndex: index,
        delta: JSON.stringify(block.arguments),
        partial: { ...partial },
      })
      stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: { ...partial } })
    }
  }
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: message.stopReason, error: message })
  } else {
    stream.push({ type: 'done', reason: message.stopReason, message })
  }
  stream.end(message)
}

async function ensureTurnActive(signal: AbortSignal, ensureActive: () => Promise<void>) {
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError('Runtime request aborted')
  }
  await ensureActive()
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError('Runtime request aborted')
  }
}

function stringifyToolOutput(result: Record<string, unknown>) {
  if (typeof result.stdout === 'string' || typeof result.stderr === 'string') {
    return [result.stdout, result.stderr]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('\n')
  }
  if (typeof result.content === 'string') {
    return result.content
  }
  return JSON.stringify(result)
}

function runtimeSystemPrompt(snapshot: Record<string, unknown>) {
  const instructions = typeof snapshot.instructions === 'string' ? snapshot.instructions.trim() : ''
  return (
    instructions || 'You are an AMA cloud-owned coding agent. Use tools when workspace inspection or edits are needed.'
  )
}

function runtimeTools(
  executor: ToolExecutor,
  values: {
    sessionId: string
    sandboxId: string
    agentSnapshot: Record<string, unknown>
    policy: ToolPolicyGate
    toolResults: ToolResultResolver
    liveness: TurnLiveness
  },
) {
  const ensure = (signal: AbortSignal | undefined) =>
    ensureTurnActive(signal ?? new AbortController().signal, () => values.liveness.ensureActive())
  const tool = (
    name: 'sandbox.exec' | 'sandbox.read' | 'sandbox.write' | 'sandbox.fetch',
    label: string,
    description: string,
    parameters: AgentTool['parameters'],
  ): AgentTool =>
    ({
      name,
      label,
      description,
      parameters,
      executionMode: 'sequential',
      async execute(toolCallId, params, signal): Promise<AgentToolResult<Record<string, unknown>>> {
        const input = params as Record<string, unknown>
        await ensure(signal)
        const decision = await values.policy.approve({ toolCallId, toolName: name, input })
        if (!decision.allowed) {
          throw new RuntimePolicyDeniedError(decision.reason ?? `Tool call blocked by AMA policy: ${name}`)
        }
        await ensure(signal)
        const providedResult = await values.toolResults.resolve({ toolCallId, toolName: name, input })
        if (providedResult) {
          return {
            content: [{ type: 'text', text: stringifyToolOutput(providedResult) }],
            details: providedResult,
          }
        }
        const result = await executor.execute(
          {
            sessionId: values.sessionId,
            sandboxId: values.sandboxId,
            toolCallId,
            toolName: name,
            input,
            cwd: '/workspace',
          },
          signal,
        )
        await ensure(signal)
        if (result.error) {
          throw new Error(JSON.stringify(result.error))
        }
        return {
          content: [{ type: 'text', text: stringifyToolOutput(result.output) }],
          details: { ...result.output, durationMs: result.durationMs },
        }
      },
    }) satisfies AgentTool

  // Agent tool attachments are the only tool source. An empty list means "no
  // restriction": agents without explicit tool attachments get the full sandbox
  // toolset, matching environment policy defaults elsewhere (defaultEffect allow).
  const toolNames = Array.isArray(values.agentSnapshot.tools)
    ? values.agentSnapshot.tools
        .map((tool) =>
          typeof tool === 'string'
            ? tool
            : tool && typeof tool === 'object' && typeof (tool as { name?: unknown }).name === 'string'
              ? (tool as { name: string }).name
              : null,
        )
        .filter((name): name is string => name !== null)
    : []
  const allowsTool = (toolName: string) =>
    toolNames.length === 0 || toolNames.includes('*') || toolNames.includes(toolName)

  return [
    tool('sandbox.exec', 'Run command', 'Run a shell command in the session workspace.', Type.Object({ command: Type.String() })),
    tool('sandbox.read', 'Read file', 'Read a UTF-8 file from the session workspace.', Type.Object({ path: Type.String() })),
    tool(
      'sandbox.write',
      'Write file',
      'Write a UTF-8 file under the session workspace.',
      Type.Object({ path: Type.String(), content: Type.String() }),
    ),
    tool(
      'sandbox.fetch',
      'Fetch URL',
      'Fetch an HTTP(S) URL over the sandbox network, subject to the session network policy.',
      Type.Object({ url: Type.String() }),
    ),
  ].filter((candidate) => allowsTool(candidate.name))
}

function createTurnStreamFn(
  modelClient: ModelClient,
  values: {
    liveness: TurnLiveness
    markCancelled: () => void
    onProviderError: (normalized: RuntimeProviderError) => void
    budget?: TurnBudget
    markPaused: () => void
  },
) {
  return (model: Model<string>, context: Context, options?: StreamOptions) => {
    const stream = createAssistantMessageEventStream()
    queueMicrotask(async () => {
      try {
        if (options?.signal?.aborted) {
          emitAssistantMessage(stream, assistantMessage(model, [], 'aborted', ZERO_USAGE, 'Runtime request aborted'))
          return
        }
        // Only pause once the transcript already contains assistant progress;
        // the first model call of an invocation always runs.
        if (values.budget?.shouldPause() && context.messages.some((message) => message.role === 'assistant')) {
          values.markPaused()
          emitAssistantMessage(stream, assistantMessage(model, [], 'aborted', ZERO_USAGE, 'Paused for continuation'))
          return
        }
        await ensureTurnActive(options?.signal ?? new AbortController().signal, () => values.liveness.ensureActive())
        const message = await modelClient.complete(model, context, options?.signal)
        await ensureTurnActive(options?.signal ?? new AbortController().signal, () => values.liveness.ensureActive())
        emitAssistantMessage(stream, message)
      } catch (error) {
        if (isRuntimeTurnCancelled(error)) {
          values.markCancelled()
        }
        const aborted = options?.signal?.aborted || isRuntimeTurnCancelled(error)
        if (!aborted && error instanceof ProviderCallError) {
          values.onProviderError(error.normalized)
        }
        emitAssistantMessage(
          stream,
          assistantMessage(
            model,
            [],
            aborted ? 'aborted' : 'error',
            ZERO_USAGE,
            error instanceof Error ? error.message : 'Model request failed',
          ),
        )
      }
    })
    return stream
  }
}

function usageEvent(message: AgentMessage, provider: string, model: string) {
  if (message.role !== 'assistant') {
    return null
  }
  return {
    type: 'usage',
    provider,
    model,
    promptTokens: message.usage.input,
    completionTokens: message.usage.output,
    totalTokens: message.usage.totalTokens,
  }
}

function turnFailureMessage(event: AgentEvent) {
  if (event.type === 'message_end' && event.message.role === 'assistant') {
    if (event.message.stopReason === 'aborted') {
      return 'Runtime request aborted'
    }
    if (event.message.stopReason === 'error') {
      return event.message.errorMessage ?? 'Runtime model request failed'
    }
  }
  if (event.type === 'tool_execution_end' && event.isError) {
    const result = event.result as { content?: Array<{ type?: string; text?: string }>; details?: unknown }
    const text = Array.isArray(result.content)
      ? result.content.map((item) => (item.type === 'text' && typeof item.text === 'string' ? item.text : '')).join('')
      : ''
    return text || 'Runtime tool execution failed'
  }
  return null
}

function isPersistedMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object' || !('role' in value)) {
    return false
  }
  const role = (value as { role?: unknown }).role
  return role === 'user' || role === 'assistant' || role === 'toolResult'
}

// Rebuilds the agent transcript from persisted (or in-memory) runtime events so
// a continuation turn resumes where the previous one left off. Prefers the
// latest agent_end snapshot, else the accumulated message_end messages.
export function runtimeMessagesFromEvents(
  events: Array<{ type?: string; payload: string | Record<string, unknown> }>,
): AgentMessage[] {
  let latestAgentEndMessages: AgentMessage[] | null = null
  const messageEndMessages: AgentMessage[] = []
  for (const event of events) {
    const payload: unknown = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
    if (!payload || typeof payload !== 'object') {
      continue
    }
    const record = payload as Record<string, unknown>
    const sourceType =
      typeof event.type === 'string' ? event.type : typeof record.type === 'string' ? record.type : undefined
    if (sourceType === 'agent_end' && Array.isArray(record.messages)) {
      const messages = record.messages.filter(isPersistedMessage)
      if (messages.length > 0) {
        latestAgentEndMessages = messages
      }
      continue
    }
    if (sourceType !== 'message_end' || !isPersistedMessage(record.message)) {
      continue
    }
    messageEndMessages.push(record.message)
  }
  return latestAgentEndMessages ?? messageEndMessages
}

export async function runTurn(input: TurnEngineInput): Promise<TurnEngineResult> {
  const controller = new AbortController()
  const { model } = input
  const provider = input.providerLabel
  const modelId = input.modelLabel
  let aborted = false
  let cancelled = false
  let paused = false
  let failureMessage: string | null = null
  let providerError: RuntimeProviderError | null = null
  const agent = new Agent({
    initialState: {
      systemPrompt: runtimeSystemPrompt(input.agentSnapshot),
      model,
      tools: runtimeTools(input.executor, {
        sessionId: input.sessionId,
        sandboxId: input.sandboxId,
        agentSnapshot: input.agentSnapshot,
        policy: input.policy,
        toolResults: input.toolResults,
        liveness: input.liveness,
      }),
      messages: input.messages ?? [],
    },
    streamFn: createTurnStreamFn(input.modelClient, {
      liveness: input.liveness,
      markCancelled: () => {
        cancelled = true
      },
      onProviderError: (normalized) => {
        providerError = normalized
      },
      ...(input.budget ? { budget: input.budget } : {}),
      markPaused: () => {
        paused = true
      },
    }),
    toolExecution: 'sequential',
    sessionId: input.sessionId,
  })

  agent.subscribe(async (event: AgentEvent) => {
    // Everything after a pause is filler from the synthetic paused message;
    // completed turns are already persisted and the continuation rebuilds them.
    if (paused) {
      return
    }
    try {
      await ensureTurnActive(controller.signal, () => input.liveness.ensureActive())
    } catch (error) {
      if (isRuntimeTurnCancelled(error)) {
        cancelled = true
        aborted = true
        agent.abort()
        return
      }
      throw error
    }
    const eventFailure = turnFailureMessage(event)
    if (eventFailure) {
      failureMessage = eventFailure
      aborted ||= eventFailure === 'Runtime request aborted'
    }
    await input.sink.emit({ ...event }, EVENT_META)
    if (event.type === 'message_end') {
      const usage = usageEvent(event.message, provider, modelId)
      if (usage) {
        await input.sink.emit(usage, EVENT_META)
      }
      // Surface adapter-normalized provider failures as canonical runtime.error
      // events: stable category, safe message, retry metadata.
      if (event.message.role === 'assistant' && event.message.stopReason === 'error' && providerError) {
        const normalized: RuntimeProviderError = providerError
        providerError = null
        await input.sink.emit(
          {
            type: 'error',
            message: normalized.message,
            category: normalized.category,
            retryable: normalized.retryable,
            ...(normalized.retryAfterSeconds !== undefined ? { retryAfterSeconds: normalized.retryAfterSeconds } : {}),
            provider,
            model: modelId,
          },
          EVENT_META,
        )
      }
    }
  })

  controller.signal.addEventListener('abort', () => agent.abort(), { once: true })
  try {
    await ensureTurnActive(controller.signal, () => input.liveness.ensureActive())
    if (input.continuation) {
      await agent.continue()
    } else {
      if (typeof input.prompt !== 'string') {
        throw new Error('Session turn requires a prompt unless it is a continuation')
      }
      await agent.prompt(input.prompt)
    }
    await agent.waitForIdle()
    // A pause only fires when the loop was about to start another model call,
    // so by construction the run still has work for a continuation.
    if (paused) {
      return { status: 'paused' }
    }
    if (aborted || cancelled) {
      return { status: 'aborted' }
    }
    if (failureMessage) {
      throw new Error(failureMessage)
    }
    return { status: 'idle' }
  } catch (error) {
    if (isRuntimeTurnCancelled(error)) {
      return { status: 'aborted' }
    }
    throw error
  } finally {
    agent.abort()
  }
}
