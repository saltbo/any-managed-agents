import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  type AssistantMessage,
  type Context,
  getModel,
  type Model,
  type ToolCall,
  type Usage,
} from '@earendil-works/pi-ai'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  RuntimeTurnCancelledError,
} from '../../runtime-core/errors'
import type { ModelClient } from '../../runtime-core/ports'
import { assistantMessage, runTurn, runtimeMessagesFromEvents, ZERO_USAGE } from '../../runtime-core/turn-engine'
import { toolExecutor } from '../adapters/runtime/sandbox-tool-executor'
import { extractProviderUsage, normalizeProviderError, providerFamily } from '../domain/provider-adapter'
import type { Env } from '../env'
import type { RuntimeSecretEnvEntry } from './secret-env'

// The turn engine, ports, and error vocabulary live in runtime-core (shared by
// the Worker and, in Phase 3, the runtime-bridge runner). This module is the
// Worker host: it resolves the model, builds the Cloudflare tool executor and
// the Workers AI model client, maps the SessionTurnInput callbacks to ports,
// and owns cloud-only sandbox start/stop and workspace preparation.
export {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  RuntimeTurnCancelledError,
}

export type SessionRuntimeStartInput = {
  sessionId: string
  sandboxId: string
  runtime?: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  environmentSnapshot: Record<string, unknown> | null
  mcpSnapshot?: Record<string, unknown>
  resourceRefs?: Record<string, unknown>[]
  runtimeEnv?: Record<string, string>
  runtimeSecretEnv?: RuntimeSecretEnvEntry[]
  // Secret env values already resolved from the vault by the control plane.
  // Applied to the sandbox session env but never written to workspace files.
  resolvedSecretEnv?: Record<string, string>
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

// Canonical home is runtime-core/ports; imported for local use and re-exported
// so existing importers keep their import paths.
import type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput } from '../../runtime-core/ports'

export type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput }

export type SessionTurnResult = {
  // 'paused': the run still wants more model turns but yielded its execution
  // budget; the caller re-enters with `continuation` to pick up the
  // transcript (rebuilt from persisted events) where it left off.
  status: 'idle' | 'aborted' | 'paused'
}

export type SessionTurnInput = {
  sessionId: string
  sandboxId: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  // Required unless `continuation` is set: a continuation resumes from the
  // persisted transcript whose last message is a tool result.
  prompt?: string
  continuation?: boolean
  messages?: AgentMessage[]
  // Checked before each model call after the first; returning true pauses the run.
  shouldPause?: () => boolean
  ensureActive?: () => Promise<void>
  onEvent: (event: Record<string, unknown>, metadata?: Record<string, unknown>) => Promise<void>
  approveToolCall?: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision>
  // Supplies a caller-provided tool result (e.g. an approved custom tool
  // outcome) instead of executing the tool in the sandbox.
  resolveToolResult?: (input: RuntimeToolPolicyInput) => Promise<Record<string, unknown> | null>
}

async function getSandboxBinding() {
  const { getSandbox } = await import('@cloudflare/sandbox')
  return getSandbox
}

export function runtimeEndpointPath(sessionId: string) {
  return `/api/v1/runtime/sessions/${sessionId}/rpc`
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
      // The unified { credentialId, versionId? } reference passes through as
      // declarative metadata; the workspace resolves the git token from env.
      ...(resourceRef.credentialRef ? { credentialRef: resourceRef.credentialRef } : {}),
      status: 'declared',
    }))
    .sort((left, right) => String(left.mountPath).localeCompare(String(right.mountPath)))
  return {
    version: 1,
    workspaceRoot: '/workspace',
    resources,
  }
}

const GIT_CLONE_TIMEOUT_MS = 120_000
const GITHUB_NAME_RE = /^[A-Za-z0-9_.-]+$/

type CloudWorkspaceSandbox = {
  exec(
    command: string,
    options?: { cwd?: string; timeout?: number },
  ): Promise<{ success?: boolean; exitCode?: number; stdout?: string; stderr?: string }>
  writeFile(path: string, content: string, options?: { encoding?: string }): Promise<unknown>
}

async function execOrThrow(sandbox: CloudWorkspaceSandbox, command: string, options?: { timeout?: number }) {
  const result = await sandbox.exec(command, options)
  if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    throw new Error(
      `Sandbox workspace setup failed (exit ${result.exitCode}): ${result.stderr || result.stdout || command}`,
    )
  }
  return result
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// Parity with the self-hosted runner's prepareRuntimeWorkspace: configure the
// agent git identity, store the GitHub credential, and clone declared
// github_repository resources so the agent starts with a ready workspace.
async function prepareCloudWorkspace(
  sandbox: CloudWorkspaceSandbox,
  values: { resourceRefs: Record<string, unknown>[]; env: Record<string, string> },
) {
  const manifest = workspaceResourceManifest(values.resourceRefs)
  const token = values.env.GH_TOKEN ?? values.env.GITHUB_TOKEN
  if (values.env.GIT_AUTHOR_NAME) {
    await execOrThrow(sandbox, `git config --global user.name ${shellQuote(values.env.GIT_AUTHOR_NAME)}`)
  }
  if (values.env.GIT_AUTHOR_EMAIL) {
    await execOrThrow(sandbox, `git config --global user.email ${shellQuote(values.env.GIT_AUTHOR_EMAIL)}`)
  }
  if (token) {
    await execOrThrow(sandbox, 'git config --global credential.helper store')
    await sandbox.writeFile('/root/.git-credentials', `https://x-access-token:${token}@github.com\n`, {
      encoding: 'utf-8',
    })
  }

  const resources = []
  for (const resource of manifest.resources) {
    const owner = String(resource.owner ?? '')
    const repo = String(resource.repo ?? '')
    if (!GITHUB_NAME_RE.test(owner) || !GITHUB_NAME_RE.test(repo)) {
      throw new Error(`Invalid github_repository resource: ${owner}/${repo}`)
    }
    const mountPath =
      typeof resource.mountPath === 'string' && resource.mountPath ? resource.mountPath : `/workspace/${repo}`
    if (!mountPath.startsWith('/workspace/')) {
      throw new Error(`github_repository mountPath must stay under /workspace: ${mountPath}`)
    }
    await execOrThrow(sandbox, `git clone https://github.com/${owner}/${repo}.git ${shellQuote(mountPath)}`, {
      timeout: GIT_CLONE_TIMEOUT_MS,
    })
    if (typeof resource.ref === 'string' && resource.ref) {
      await execOrThrow(sandbox, `git -C ${shellQuote(mountPath)} checkout ${shellQuote(resource.ref)}`)
    }
    resources.push({ ...resource, mountPath, status: 'cloned' })
  }
  await sandbox.writeFile('/workspace/.ama/resources.json', JSON.stringify({ ...manifest, resources }), {
    encoding: 'utf-8',
  })
}

export async function startSessionRuntime(
  env: Env,
  input: SessionRuntimeStartInput,
): Promise<SessionRuntimeStartResult> {
  const model = resolveRuntimeModel(env, input.provider, input.model)
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
        model,
        runtime: input.runtime ?? 'ama',
        agentSnapshot: input.agentSnapshot,
        environmentSnapshot: input.environmentSnapshot,
        mcpSnapshot: input.mcpSnapshot ?? { connectors: [] },
        runtimeEnv: input.runtimeEnv ?? {},
        runtimeSecretEnv: input.runtimeSecretEnv ?? [],
      }),
      { encoding: 'utf-8' },
    )
    await sandbox.writeFile('/workspace/.ama/runtime-env.json', JSON.stringify(input.runtimeEnv ?? {}), {
      encoding: 'utf-8',
    })
    await sandbox.writeFile('/workspace/.ama/runtime-secret-env.json', JSON.stringify(input.runtimeSecretEnv ?? []), {
      encoding: 'utf-8',
    })
    const sessionEnv = { ...(input.runtimeEnv ?? {}), ...(input.resolvedSecretEnv ?? {}) }
    if (Object.keys(sessionEnv).length > 0) {
      await sandbox.setEnvVars(sessionEnv)
    }
    await prepareCloudWorkspace(sandbox, {
      resourceRefs: input.resourceRefs ?? [],
      env: sessionEnv,
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

function piProviderName(provider: string) {
  return provider === 'workers-ai' ? 'cloudflare-workers-ai' : provider
}

function runtimeDefaultModel(env: Env, provider: string) {
  if (provider === 'workers-ai' || provider === 'cloudflare-workers-ai') {
    return env.AMA_DEFAULT_MODEL ?? '@cf/moonshotai/kimi-k2.6'
  }
  throw new Error(`Runtime model is required for provider: ${provider}`)
}

function resolveRuntimeModel(env: Env, provider: string, model: string | null) {
  return model ?? runtimeDefaultModel(env, provider)
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
  return (value as unknown[])
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

function usageFromProvider(provider: string, raw: Record<string, unknown> | null): Usage {
  const usage = extractProviderUsage(providerFamily(provider), raw)
  if (!usage) {
    return ZERO_USAGE
  }
  return {
    input: usage.promptTokens,
    output: usage.completionTokens,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    cost: ZERO_USAGE.cost,
  }
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
    usageFromProvider(model.provider, record),
  )
}

function testToolCallMessage(model: Model<string>, toolCall: ToolCall) {
  return assistantMessage(model, [toolCall], 'toolUse', {
    ...ZERO_USAGE,
    input: 10,
    output: 4,
    totalTokens: 14,
  })
}

// Deterministic tool-call grammar for AMA_RUNTIME_MODE=test prompts, so e2e
// scenarios can drive specific sandbox operations through the real agent loop.
function testPromptToolCall(prompt: string): ToolCall | null {
  const write = prompt.match(/write the file (\S+) with content (.+)$/i)
  if (write?.[1] && write[2]) {
    return {
      type: 'toolCall',
      id: 'call_write_file',
      name: 'sandbox.write',
      arguments: { path: write[1], content: write[2].trim() },
    }
  }
  const read = prompt.match(/read the file (\S+)/i)
  if (read?.[1]) {
    return { type: 'toolCall', id: 'call_read_file', name: 'sandbox.read', arguments: { path: read[1] } }
  }
  const url = prompt.match(/https?:\/\/[^\s"']+/)
  if (url && /fetch|download|outbound/i.test(prompt)) {
    return { type: 'toolCall', id: 'call_fetch_url', name: 'sandbox.fetch', arguments: { url: url[0] } }
  }
  const command = prompt.match(/run the sandbox command "([^"]+)"/i)
  if (command?.[1]) {
    return { type: 'toolCall', id: 'call_sandbox_command', name: 'sandbox.exec', arguments: { command: command[1] } }
  }
  if (/status|inspect|whoami|command|sandbox/i.test(prompt)) {
    return { type: 'toolCall', id: 'call_git_status', name: 'sandbox.exec', arguments: { command: 'git status' } }
  }
  return null
}

// Test-mode provider failure simulation: prompts of the form
// "simulate provider <category> error" throw a raw, provider-shaped error so
// the real adapter normalization path is exercised end to end. The raw
// payload deliberately embeds marker text that must never surface.
const SIMULATED_PROVIDER_ERROR_RE =
  /simulate provider (auth|quota|rate limit|model unavailable|invalid request|network|unknown) error/i

function simulatedProviderFailure(prompt: string): unknown | null {
  const match = SIMULATED_PROVIDER_ERROR_RE.exec(prompt)
  if (!match?.[1]) {
    return null
  }
  const marker = 'raw-provider-error-detail'
  switch (match[1].toLowerCase()) {
    case 'auth':
      return Object.assign(new Error(`401 invalid api key sk-${marker}`), { status: 401, code: 'invalid_api_key' })
    case 'quota':
      return Object.assign(new Error(`429 insufficient_quota ${marker}`), { status: 429, code: 'insufficient_quota' })
    case 'rate limit':
      return Object.assign(new Error(`429 too many requests ${marker}`), {
        status: 429,
        code: 'rate_limit_exceeded',
        retryAfterSeconds: 7,
      })
    case 'model unavailable':
      return Object.assign(new Error(`404 model_not_found ${marker}`), { status: 404, code: 'model_not_found' })
    case 'invalid request':
      return Object.assign(new Error(`400 invalid_request_error ${marker}`), {
        status: 400,
        code: 'invalid_request_error',
      })
    case 'network':
      return new TypeError(`fetch failed ${marker}`)
    default:
      return new Error(`provider call collapsed without diagnostics ${marker}`)
  }
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
  // The explicit tool-call grammar wins over the fuzzy previous-prompt echo:
  // a quoted sandbox command may legitimately contain words like "history".
  const explicitToolCall = testPromptToolCall(prompt)
  if (explicitToolCall) {
    return testToolCallMessage(model, explicitToolCall)
  }
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
  const toolCall = testPromptToolCall(prompt)
  if (toolCall) {
    return testToolCallMessage(model, toolCall)
  }
  return assistantMessage(model, [{ type: 'text', text: `AMA runtime processed: ${prompt}` }], 'stop', {
    ...ZERO_USAGE,
    input: 9,
    output: 5,
    totalTokens: 14,
  })
}

// The Worker's ModelClient port: Workers AI egress with deterministic test-mode
// simulation. Owns the OpenAI request/response mapping and provider-error
// normalization so the turn engine stays platform-free. Failures are normalized
// through the provider adapter before they leave this seam.
function workersAiModelClient(env: Env): ModelClient {
  return {
    async complete(model, context, signal) {
      try {
        if (env.AMA_RUNTIME_MODE === 'test') {
          const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
          const prompt = latestUser && latestUser.role === 'user' ? textContent(latestUser.content) : ''
          if (/wait for cancellation/i.test(prompt)) {
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const simulated = simulatedProviderFailure(prompt)
          if (simulated) {
            throw simulated
          }
          return testAssistantMessage(model, context)
        }
        return providerAssistantMessage(
          model,
          await env.AI.run(
            model.id,
            {
              model: model.id,
              messages: openAiMessages(context),
              tools: openAiTools(context),
            },
            signal ? { signal } : undefined,
          ),
        )
      } catch (error) {
        if (isRuntimeTurnCancelled(error) || error instanceof ProviderCallError) {
          throw error
        }
        throw new ProviderCallError(normalizeProviderError(providerFamily(model.provider), error))
      }
    },
  }
}

// Canonical home is runtime-core/turn-engine; re-exported for existing importers.
export { runtimeMessagesFromEvents }

// Worker host adapter over the shared turn engine: resolve the Workers AI
// model, build the Cloudflare tool executor and model client, and map the
// optional SessionTurnInput callbacks to the engine's ports (absent callbacks
// become permissive defaults — no gating, no liveness check, never pause).
export async function runSessionTurn(env: Env, input: SessionTurnInput): Promise<SessionTurnResult> {
  const provider = piProviderName(input.provider)
  const modelId = resolveRuntimeModel(env, input.provider, input.model)
  const model = runtimeModel(input.provider, modelId)
  return runTurn({
    sessionId: input.sessionId,
    sandboxId: input.sandboxId,
    model,
    providerLabel: provider,
    modelLabel: modelId,
    agentSnapshot: input.agentSnapshot,
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.continuation ? { continuation: true } : {}),
    ...(input.messages ? { messages: input.messages } : {}),
    sink: { emit: (event, metadata) => input.onEvent(event, metadata) },
    policy: { approve: input.approveToolCall ?? (async () => ({ allowed: true })) },
    toolResults: { resolve: input.resolveToolResult ?? (async () => null) },
    liveness: { ensureActive: input.ensureActive ?? (async () => {}) },
    ...(input.shouldPause ? { budget: { shouldPause: input.shouldPause } } : {}),
    executor: toolExecutor(env),
    modelClient: workersAiModelClient(env),
  })
}
