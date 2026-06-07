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
  getModel,
  type Model,
  type StreamOptions,
  type ToolCall,
  Type,
  type Usage,
} from '@earendil-works/pi-ai'
import type { Env } from '../env'
import { toolExecutor } from './tool-executor'

export type SessionRuntimeStartInput = {
  sessionId: string
  sandboxId: string
  runtime?: string
  provider: string
  model: string
  agentSnapshot: Record<string, unknown>
  environmentSnapshot: Record<string, unknown> | null
  mcpSnapshot?: Record<string, unknown>
  resourceRefs?: Record<string, unknown>[]
  runtimeEnv?: Record<string, string>
  runtimeSecretEnv?: Array<{ name: string; ref: string }>
}

export type SessionRuntimeStartResult = {
  sandboxId: string
  runtimeEndpointPath: string
  metadata: Record<string, unknown>
}

export type RuntimeToolCall = {
  id?: string
  name?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: Record<string, unknown>
  durationMs?: number
}

export type RuntimeCommandBody = {
  type?: string
  message?: string
  response?: string
  simulateError?: boolean
  errorMessage?: string
  toolCalls?: RuntimeToolCall[]
}

export type RuntimeToolPolicyInput = {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export type RuntimeToolPolicyDecision = {
  allowed: boolean
  reason?: string
}

export type SessionTurnResult = {
  status: 'idle' | 'aborted'
}

export type SessionTurnInput = {
  sessionId: string
  sandboxId: string
  provider: string
  model: string
  agentSnapshot: Record<string, unknown>
  prompt: string
  messages?: AgentMessage[]
  ensureActive?: () => Promise<void>
  onEvent: (event: Record<string, unknown>, metadata?: Record<string, unknown>) => Promise<void>
  approveToolCall?: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision>
}

export class RuntimeTurnCancelledError extends Error {
  constructor(message = 'Session runtime is no longer active') {
    super(message)
    this.name = 'RuntimeTurnCancelledError'
  }
}

export function isRuntimeTurnCancelled(error: unknown) {
  return error instanceof RuntimeTurnCancelledError
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

async function getSandboxBinding() {
  const { getSandbox } = await import('@cloudflare/sandbox')
  return getSandbox
}

export function runtimeEndpointPath(sessionId: string) {
  return `/runtime/sessions/${sessionId}/rpc`
}

export function workspaceResourceManifest(resourceRefs: Record<string, unknown>[] = []) {
  const resources = resourceRefs
    .filter((resourceRef) => resourceRef.type === 'github_repository')
    .map((resourceRef) => ({
      type: 'github_repository',
      owner: resourceRef.owner,
      repo: resourceRef.repo,
      mountPath: resourceRef.mountPath,
      ...(typeof resourceRef.ref === 'string' ? { ref: resourceRef.ref } : {}),
      ...(typeof resourceRef.credentialRef === 'string' ? { credentialRef: resourceRef.credentialRef } : {}),
      status: 'declared',
    }))
    .sort((left, right) => String(left.mountPath).localeCompare(String(right.mountPath)))
  return {
    version: 1,
    workspaceRoot: '/workspace',
    resources,
  }
}

export async function startSessionRuntime(
  env: Env,
  input: SessionRuntimeStartInput,
): Promise<SessionRuntimeStartResult> {
  if (env.AMA_RUNTIME_MODE !== 'test') {
    const getSandbox = await getSandboxBinding()
    const sandbox = getSandbox(env.SANDBOX, input.sandboxId, { keepAlive: true, normalizeId: true })
    await sandbox.exec('mkdir -p /workspace/.ama')
    await sandbox.writeFile(
      '/workspace/.ama/session.json',
      JSON.stringify({
        sessionId: input.sessionId,
        sandboxId: input.sandboxId,
        provider: input.provider,
        model: input.model,
        runtime: input.runtime ?? 'ama',
        agentSnapshot: input.agentSnapshot,
        environmentSnapshot: input.environmentSnapshot,
        mcpSnapshot: input.mcpSnapshot ?? { connectors: [] },
        runtimeEnv: input.runtimeEnv ?? {},
        runtimeSecretEnv: input.runtimeSecretEnv ?? [],
      }),
      { encoding: 'utf-8' },
    )
    await sandbox.writeFile(
      '/workspace/.ama/resources.json',
      JSON.stringify(workspaceResourceManifest(input.resourceRefs)),
      {
        encoding: 'utf-8',
      },
    )
    await sandbox.writeFile('/workspace/.ama/runtime-env.json', JSON.stringify(input.runtimeEnv ?? {}), {
      encoding: 'utf-8',
    })
    await sandbox.writeFile('/workspace/.ama/runtime-secret-env.json', JSON.stringify(input.runtimeSecretEnv ?? []), {
      encoding: 'utf-8',
    })
  }

  return {
    sandboxId: input.sandboxId,
    runtimeEndpointPath: runtimeEndpointPath(input.sessionId),
    metadata: {
      runtimeMode: env.AMA_RUNTIME_MODE === 'test' ? 'test' : 'live',
      runtimeDriver: 'ama-cloud',
      runtimeBackend: 'ama-cloud',
      runtimeProtocol: 'ama-runtime-rpc',
      loop: 'cloud-session-runtime',
      executor: 'cloudflare-sandbox',
      piCorePackage: '@earendil-works/pi-agent-core',
      resourceManifestPath: '/workspace/.ama/resources.json',
      runtimeEnvPath: '/workspace/.ama/runtime-env.json',
      runtimeSecretEnvPath: '/workspace/.ama/runtime-secret-env.json',
    },
  }
}

export async function stopSessionRuntime(env: Env, sandboxId: string) {
  await toolExecutor(env).stop?.(sandboxId)
}

export function runtimeToolCalls(body: unknown) {
  if (!body || typeof body !== 'object') {
    return []
  }
  const calls = (body as RuntimeCommandBody).toolCalls
  return Array.isArray(calls) ? calls.filter((call): call is RuntimeToolCall => !!call && typeof call === 'object') : []
}

export async function executeRuntimeToolCalls(
  env: Env,
  values: {
    sessionId: string
    sandboxId: string
    body: unknown
  },
) {
  const executor = toolExecutor(env)
  const results = []
  for (const [index, call] of runtimeToolCalls(values.body).entries()) {
    const toolCallId = typeof call.id === 'string' ? call.id : `tool_${index + 1}`
    const toolName = typeof call.name === 'string' ? call.name : 'tool'
    const input = call.input ?? {}
    results.push(
      await executor.execute({
        sessionId: values.sessionId,
        sandboxId: values.sandboxId,
        toolCallId,
        toolName,
        input: {
          ...input,
          ...(call.output ? { output: call.output } : {}),
          ...(call.error ? { error: call.error } : {}),
          ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
        },
        cwd: '/workspace',
      }),
    )
  }
  return results
}

function runtimeSystemPrompt(snapshot: Record<string, unknown>) {
  const parts = [snapshot.systemPrompt, snapshot.instructions].filter((value): value is string => {
    return typeof value === 'string' && value.trim().length > 0
  })
  return (
    parts.join('\n\n') ||
    'You are an AMA cloud-owned coding agent. Use tools when workspace inspection or edits are needed.'
  )
}

function piProviderName(provider: string) {
  return provider === 'workers-ai' ? 'cloudflare-workers-ai' : provider
}

function fallbackModel(provider: string, model: string): Model<string> {
  return {
    id: model,
    name: model,
    api: 'ama-workers-ai',
    provider,
    baseUrl: 'cloudflare-ai-binding://AI',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  }
}

function runtimeModel(provider: string, model: string) {
  if (provider === 'workers-ai' || provider === 'cloudflare-workers-ai') {
    return getModel('cloudflare-workers-ai', model as never) ?? fallbackModel('cloudflare-workers-ai', model)
  }
  throw new Error(`Unsupported AMA runtime provider: ${provider}`)
}

function textContent(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((item) => {
      if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
        return String(item.text)
      }
      return ''
    })
    .join('')
}

function openAiMessages(context: Context) {
  const messages: Array<Record<string, unknown>> = []
  if (context.systemPrompt) {
    messages.push({ role: 'system', content: context.systemPrompt })
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
      messages.push({
        role: 'assistant',
        content: text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
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

function openAiTools(context: Context) {
  return (context.tools ?? []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function usageFromProvider(raw: Record<string, unknown> | null): Usage {
  const usage = raw?.usage && typeof raw.usage === 'object' ? (raw.usage as Record<string, unknown>) : {}
  const input = numberValue(usage.prompt_tokens) ?? numberValue(usage.input_tokens) ?? 0
  const output = numberValue(usage.completion_tokens) ?? numberValue(usage.output_tokens) ?? 0
  const totalTokens = numberValue(usage.total_tokens) ?? input + output
  return {
    input,
    output,
    cacheRead: numberValue(usage.cache_read_input_tokens) ?? 0,
    cacheWrite: numberValue(usage.cache_creation_input_tokens) ?? 0,
    totalTokens,
    cost: ZERO_USAGE.cost,
  }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function assistantMessage(
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

function parseToolArguments(value: unknown) {
  if (!value) {
    return {}
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return {}
}

function providerAssistantMessage(model: Model<string>, raw: unknown) {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const choice =
    Array.isArray(record?.choices) && record.choices[0] && typeof record.choices[0] === 'object'
      ? (record.choices[0] as Record<string, unknown>)
      : null
  const message =
    choice?.message && typeof choice.message === 'object' ? (choice.message as Record<string, unknown>) : null
  const content: AssistantMessage['content'] = []
  const text = textContent(message?.content ?? record?.response ?? record?.text ?? raw)
  if (text) {
    content.push({ type: 'text', text })
  }
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
  for (const [index, toolCall] of toolCalls.entries()) {
    if (!toolCall || typeof toolCall !== 'object') {
      continue
    }
    const call = toolCall as Record<string, unknown>
    const fn = call.function && typeof call.function === 'object' ? (call.function as Record<string, unknown>) : {}
    const name = typeof fn.name === 'string' ? fn.name : typeof call.name === 'string' ? call.name : null
    if (!name) {
      continue
    }
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
    usageFromProvider(record),
  )
}

function testAssistantMessage(model: Model<string>, context: Context) {
  const latestMessage = context.messages.at(-1)
  if (latestMessage?.role === 'toolResult') {
    const resultText = textContent(latestMessage.content)
    return assistantMessage(model, [{ type: 'text', text: `Tool result observed: ${resultText || 'ok'}` }], 'stop', {
      ...ZERO_USAGE,
      input: 12,
      output: 7,
      totalTokens: 19,
    })
  }
  const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
  const prompt = latestUser && latestUser.role === 'user' ? textContent(latestUser.content) : ''
  if (/previous prompt|prior prompt|history/i.test(prompt)) {
    const previousUser = [...context.messages]
      .reverse()
      .filter((message) => message.role === 'user')
      .at(1)
    const previousPrompt = previousUser && previousUser.role === 'user' ? textContent(previousUser.content) : ''
    return assistantMessage(
      model,
      [{ type: 'text', text: `Previous user prompt: ${previousPrompt || 'none'}` }],
      'stop',
      {
        ...ZERO_USAGE,
        input: 11,
        output: 6,
        totalTokens: 17,
      },
    )
  }
  if (/status|inspect|whoami|command|sandbox/i.test(prompt)) {
    return assistantMessage(
      model,
      [{ type: 'toolCall', id: 'call_git_status', name: 'sandbox.exec', arguments: { command: 'git status' } }],
      'toolUse',
      { ...ZERO_USAGE, input: 10, output: 4, totalTokens: 14 },
    )
  }
  return assistantMessage(model, [{ type: 'text', text: `AMA runtime processed: ${prompt}` }], 'stop', {
    ...ZERO_USAGE,
    input: 9,
    output: 5,
    totalTokens: 14,
  })
}

async function ensureTurnActive(signal: AbortSignal, ensureActive?: () => Promise<void>) {
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError('Runtime request aborted')
  }
  await ensureActive?.()
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError('Runtime request aborted')
  }
}

function createRuntimeStreamFn(
  env: Env,
  values: {
    ensureActive?: () => Promise<void>
    markCancelled: () => void
  },
) {
  return (model: Model<string>, context: Context, options?: StreamOptions) => {
    const stream = createAssistantMessageEventStream()
    queueMicrotask(async () => {
      try {
        if (options?.signal?.aborted) {
          const aborted = assistantMessage(model, [], 'aborted', ZERO_USAGE, 'Runtime request aborted')
          emitAssistantMessage(stream, aborted)
          return
        }
        await ensureTurnActive(options?.signal ?? new AbortController().signal, values.ensureActive)
        const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
        const prompt = latestUser && latestUser.role === 'user' ? textContent(latestUser.content) : ''
        if (env.AMA_RUNTIME_MODE === 'test' && /wait for cancellation/i.test(prompt)) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const message =
          env.AMA_RUNTIME_MODE === 'test'
            ? testAssistantMessage(model, context)
            : providerAssistantMessage(
                model,
                await env.AI.run(
                  model.id,
                  {
                    model: model.id,
                    messages: openAiMessages(context),
                    tools: openAiTools(context),
                  },
                  options?.signal ? { signal: options.signal } : undefined,
                ),
              )
        await ensureTurnActive(options?.signal ?? new AbortController().signal, values.ensureActive)
        emitAssistantMessage(stream, message)
      } catch (error) {
        if (isRuntimeTurnCancelled(error)) {
          values.markCancelled()
        }
        const failed = assistantMessage(
          model,
          [],
          options?.signal?.aborted || isRuntimeTurnCancelled(error) ? 'aborted' : 'error',
          ZERO_USAGE,
          error instanceof Error ? error.message : 'Model request failed',
        )
        emitAssistantMessage(stream, failed)
      }
    })
    return stream
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

function runtimeTools(
  env: Env,
  values: {
    sessionId: string
    sandboxId: string
    agentSnapshot: Record<string, unknown>
    ensureActive?: () => Promise<void>
    approveToolCall?: SessionTurnInput['approveToolCall']
  },
) {
  const executor = toolExecutor(env)
  const tool = (
    name: 'sandbox.exec' | 'sandbox.read' | 'sandbox.write',
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
        await ensureTurnActive(signal ?? new AbortController().signal, values.ensureActive)
        const decision = await values.approveToolCall?.({ toolCallId, toolName: name, input })
        if (decision && !decision.allowed) {
          throw new Error(decision.reason ?? `Tool call blocked by AMA policy: ${name}`)
        }
        await ensureTurnActive(signal ?? new AbortController().signal, values.ensureActive)
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
        await ensureTurnActive(signal ?? new AbortController().signal, values.ensureActive)
        if (result.error) {
          throw new Error(JSON.stringify(result.error))
        }
        return {
          content: [{ type: 'text', text: stringifyToolOutput(result.output) }],
          details: result.output,
        }
      },
    }) satisfies AgentTool

  const allowedTools = Array.isArray(values.agentSnapshot.allowedTools)
    ? values.agentSnapshot.allowedTools.filter((tool): tool is string => typeof tool === 'string')
    : []
  const allowsTool = (toolName: string) => allowedTools.includes('*') || allowedTools.includes(toolName)

  return [
    tool(
      'sandbox.exec',
      'Run command',
      'Run a shell command in the session workspace.',
      Type.Object({ command: Type.String() }),
    ),
    tool(
      'sandbox.read',
      'Read file',
      'Read a UTF-8 file from the session workspace.',
      Type.Object({ path: Type.String() }),
    ),
    tool(
      'sandbox.write',
      'Write file',
      'Write a UTF-8 file under the session workspace.',
      Type.Object({ path: Type.String(), content: Type.String() }),
    ),
  ].filter((candidate) => allowsTool(candidate.name))
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

export function runtimeMessagesFromEvents(events: Array<{ type?: string; payload: string | Record<string, unknown> }>) {
  let latestAgentEndMessages: AgentMessage[] | null = null
  const messageEndMessages: AgentMessage[] = []
  for (const event of events) {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
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

export async function runSessionTurn(env: Env, input: SessionTurnInput): Promise<SessionTurnResult> {
  const controller = new AbortController()
  const provider = piProviderName(input.provider)
  const model = runtimeModel(input.provider, input.model)
  let aborted = false
  let cancelled = false
  let failureMessage: string | null = null
  const agent = new Agent({
    initialState: {
      systemPrompt: runtimeSystemPrompt(input.agentSnapshot),
      model,
      tools: runtimeTools(env, {
        sessionId: input.sessionId,
        sandboxId: input.sandboxId,
        agentSnapshot: input.agentSnapshot,
        approveToolCall: input.approveToolCall,
        ...(input.ensureActive ? { ensureActive: input.ensureActive } : {}),
      }),
      messages: input.messages ?? [],
    },
    streamFn: createRuntimeStreamFn(env, {
      markCancelled: () => {
        cancelled = true
      },
      ...(input.ensureActive ? { ensureActive: input.ensureActive } : {}),
    }),
    toolExecution: 'sequential',
    sessionId: input.sessionId,
  })

  agent.subscribe(async (event: AgentEvent) => {
    try {
      await ensureTurnActive(controller.signal, input.ensureActive)
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
    await input.onEvent(event as unknown as Record<string, unknown>, {
      source: 'ama-cloud-runtime',
      piCorePackage: '@earendil-works/pi-agent-core',
    })
    if (event.type === 'message_end') {
      const usage = usageEvent(event.message, provider, input.model)
      if (usage) {
        await input.onEvent(usage, {
          source: 'ama-cloud-runtime',
          piCorePackage: '@earendil-works/pi-agent-core',
        })
      }
    }
  })

  controller.signal.addEventListener('abort', () => agent.abort(), { once: true })
  try {
    await ensureTurnActive(controller.signal, input.ensureActive)
    await agent.prompt(input.prompt)
    await agent.waitForIdle()
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
