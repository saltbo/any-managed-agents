// The AMA turn-execution core. It drives the pi-agent-core loop,
// gates tools through the policy port, emits canonical events to the sink, and
// reaches the model and the sandbox only through the ModelClient / ToolExecutor
// ports. The loop runs in the cloud control plane; self-hosted AMA sessions use
// the same cloud loop with a runner-backed sandbox executor.
import { AMA_SANDBOX_TOOL_NAMES, type AmaSandboxToolName } from '@ama/runtime-contracts/agent-tools'
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
} from '@earendil-works/pi-agent-core'
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
import {
  CANCELLATION_REASON,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  type RuntimeProviderError,
  RuntimeTurnCancelledError,
} from './errors'
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
import { reduceTurnStatus, type TurnStatus } from './turn-status'

// runtimeMessagesFromEvents moved to ./transcript; re-exported here for the
// existing import paths.
export { runtimeMessagesFromEvents } from './transcript'

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

export function emitAssistantMessage(stream: AssistantMessageEventStream, message: AssistantMessage) {
  stream.push({ type: 'start', partial: { ...message, content: [] } })
  const partial: AssistantMessage = { ...message, content: [] }
  // contentIndex must track the position in `partial.content` (which only grows
  // for emitted text/toolCall blocks), NOT the source index — otherwise any
  // skipped block desyncs the two index spaces and the partial mutation lands on
  // the wrong (or an undefined) slot.
  for (const block of message.content) {
    if (!block) {
      continue
    }
    if (block.type === 'text') {
      const contentIndex = partial.content.length
      partial.content = [...partial.content, { type: 'text', text: '' }]
      stream.push({ type: 'text_start', contentIndex, partial: { ...partial } })
      ;(partial.content[contentIndex] as { type: 'text'; text: string }).text = block.text
      stream.push({ type: 'text_delta', contentIndex, delta: block.text, partial: { ...partial } })
      stream.push({ type: 'text_end', contentIndex, content: block.text, partial: { ...partial } })
      continue
    }
    if (block.type === 'toolCall') {
      const contentIndex = partial.content.length
      partial.content = [...partial.content, { type: 'toolCall', id: block.id, name: block.name, arguments: {} }]
      stream.push({ type: 'toolcall_start', contentIndex, partial: { ...partial } })
      ;(partial.content[contentIndex] as ToolCall).arguments = block.arguments
      stream.push({
        type: 'toolcall_delta',
        contentIndex,
        delta: JSON.stringify(block.arguments),
        partial: { ...partial },
      })
      stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial: { ...partial } })
    }
  }
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: message.stopReason, error: message })
  } else {
    stream.push({ type: 'done', reason: message.stopReason, message })
  }
  stream.end(message)
}

export async function ensureTurnActive(signal: AbortSignal, ensureActive: () => Promise<void>) {
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError(CANCELLATION_REASON)
  }
  await ensureActive()
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError(CANCELLATION_REASON)
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
  const systemPrompt = typeof snapshot.systemPrompt === 'string' ? snapshot.systemPrompt.trim() : ''
  return (
    systemPrompt || 'You are an AMA cloud-owned coding agent. Use tools when workspace inspection or edits are needed.'
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
    engineSignal: AbortSignal
  },
) {
  const ensure = (signal: AbortSignal | undefined) =>
    ensureTurnActive(signal ?? values.engineSignal, () => values.liveness.ensureActive())
  const tool = (
    name: AmaSandboxToolName,
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

  const allowedTools = Array.isArray(values.agentSnapshot.allowedTools)
    ? values.agentSnapshot.allowedTools.filter((tool): tool is string => typeof tool === 'string')
    : [...AMA_SANDBOX_TOOL_NAMES]
  const allowsTool = (toolName: string) => allowedTools.includes(toolName)

  return [
    tool(
      'read',
      'Read file',
      'Read a UTF-8 file from the session workspace.',
      Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      }),
    ),
    tool(
      'bash',
      'Run command',
      'Run a shell command in the session workspace.',
      Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number()) }),
    ),
    tool(
      'edit',
      'Edit file',
      'Replace text in a UTF-8 file under the session workspace.',
      Type.Object({
        path: Type.String(),
        edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
      }),
    ),
    tool(
      'write',
      'Write file',
      'Write a UTF-8 file under the session workspace.',
      Type.Object({ path: Type.String(), content: Type.String() }),
    ),
    tool(
      'grep',
      'Search text',
      'Search workspace files for text using ripgrep-style matching.',
      Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        glob: Type.Optional(Type.String()),
        ignoreCase: Type.Optional(Type.Boolean()),
        literal: Type.Optional(Type.Boolean()),
        context: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      }),
    ),
    tool(
      'find',
      'Find files',
      'Find workspace files by name pattern.',
      Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number()),
      }),
    ),
    tool(
      'ls',
      'List files',
      'List files in a workspace directory.',
      Type.Object({ path: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }),
    ),
    tool(
      'fetch',
      'Fetch URL',
      'Fetch an HTTP(S) URL over the sandbox network, subject to the session network policy.',
      Type.Object({ url: Type.String() }),
    ),
    tool(
      'web_search',
      'Search web',
      'Search the web from inside the sandbox network.',
      Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()) }),
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
    engineSignal: AbortSignal
  },
) {
  return (model: Model<string>, context: Context, options?: StreamOptions) => {
    const signal = options?.signal ?? values.engineSignal
    const stream = createAssistantMessageEventStream()
    queueMicrotask(async () => {
      try {
        if (signal.aborted) {
          emitAssistantMessage(stream, assistantMessage(model, [], 'aborted', ZERO_USAGE, CANCELLATION_REASON))
          return
        }
        // Only pause once the transcript already contains assistant progress;
        // the first model call of an invocation always runs.
        if (values.budget?.shouldPause() && context.messages.some((message) => message.role === 'assistant')) {
          values.markPaused()
          emitAssistantMessage(stream, assistantMessage(model, [], 'aborted', ZERO_USAGE, 'Paused for continuation'))
          return
        }
        await ensureTurnActive(signal, () => values.liveness.ensureActive())
        const message = await modelClient.complete(model, context, signal)
        await ensureTurnActive(signal, () => values.liveness.ensureActive())
        emitAssistantMessage(stream, message)
      } catch (error) {
        if (isRuntimeTurnCancelled(error)) {
          values.markCancelled()
        }
        const aborted = signal.aborted || isRuntimeTurnCancelled(error)
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
      return CANCELLATION_REASON
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

// Maps the accumulated terminal status to the engine result. A 'failed' status
// throws (the caller's catch rethrows it); cancelled surfaces as 'aborted'. Kept
// as a function so its TurnStatus param holds the full union — the `status` local
// in runTurn is narrowed to its initializer by control-flow analysis because it
// is only reassigned inside callbacks.
function resolveTurnResult(status: TurnStatus): TurnEngineResult {
  switch (status.kind) {
    case 'paused':
      return { status: 'paused' }
    case 'cancelled':
      return { status: 'aborted' }
    case 'failed':
      throw new Error(status.message)
    default:
      return { status: 'idle' }
  }
}

export async function runTurn(input: TurnEngineInput): Promise<TurnEngineResult> {
  const controller = new AbortController()
  // Link an external cancellation source (session stop / client disconnect) to
  // the engine controller so it aborts the in-flight agent loop. Additive: when
  // no signal is supplied the engine still relies on the cooperative liveness
  // check, but cancellation is never silently disabled by a throwaway signal.
  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort()
    } else {
      input.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }
  const { model } = input
  const provider = input.providerLabel
  const modelId = input.modelLabel
  let status: TurnStatus = { kind: 'idle' }
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
        engineSignal: controller.signal,
      }),
      messages: input.messages ?? [],
    },
    streamFn: createTurnStreamFn(input.modelClient, {
      liveness: input.liveness,
      markCancelled: () => {
        status = reduceTurnStatus(status, { type: 'cancel' })
      },
      onProviderError: (normalized) => {
        providerError = normalized
      },
      ...(input.budget ? { budget: input.budget } : {}),
      markPaused: () => {
        status = reduceTurnStatus(status, { type: 'pause' })
      },
      engineSignal: controller.signal,
    }),
    toolExecution: 'sequential',
    sessionId: input.sessionId,
  })

  agent.subscribe(async (event: AgentEvent) => {
    // Everything after a pause is filler from the synthetic paused message;
    // completed turns are already persisted and the continuation rebuilds them.
    if (status.kind === 'paused') {
      return
    }
    try {
      await ensureTurnActive(controller.signal, () => input.liveness.ensureActive())
    } catch (error) {
      if (isRuntimeTurnCancelled(error)) {
        status = reduceTurnStatus(status, { type: 'cancel' })
        agent.abort()
        return
      }
      throw error
    }
    const eventFailure = turnFailureMessage(event)
    if (eventFailure) {
      status = reduceTurnStatus(
        status,
        eventFailure === CANCELLATION_REASON ? { type: 'cancel' } : { type: 'fail', message: eventFailure },
      )
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
    return resolveTurnResult(status)
  } catch (error) {
    if (isRuntimeTurnCancelled(error)) {
      return { status: 'aborted' }
    }
    throw error
  } finally {
    agent.abort()
  }
}
