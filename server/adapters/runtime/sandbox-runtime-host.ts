import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getModel, type Model } from '@earendil-works/pi-ai'
import { runtimeEndpointPath } from '@server/domain/runtime/driver'
import type { SandboxRuntimeHost } from '@server/usecases/ports'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  RuntimeTurnCancelledError,
} from '../../../runtime-core/errors'
import type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput } from '../../../runtime-core/ports'
import { runTurn, runtimeMessagesFromEvents } from '../../../runtime-core/turn-engine'
import type { Env } from '../../env'
import { canonicalProvider, isWorkersAiProvider } from '../../runtime/provider-id'
import type { RuntimeSecretEnvEntry } from '../gateways/runtime-secret-env'
import { toolExecutor } from './sandbox-tool-executor'
import { workersAiModelClient } from './workers-ai-model-client'

// Canonical home is runtime-core/ports; re-exported so existing importers keep
// their import paths.
export type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput }
// The turn engine, ports, and error vocabulary live in runtime-core (shared by
// the Worker and the runtime-bridge runner). This module is the Worker host: it
// resolves the model, builds the Cloudflare tool executor and the Workers AI
// model client, maps the SessionTurnInput callbacks to ports, and owns
// cloud-only sandbox start/stop and workspace preparation.
// Canonical home is runtime-core/turn-engine; re-exported for existing importers.
export {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  RuntimeTurnCancelledError,
  runtimeMessagesFromEvents,
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

export { runtimeEndpointPath }

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
  return canonicalProvider(provider)
}

function runtimeDefaultModel(env: Env, provider: string) {
  if (isWorkersAiProvider(provider)) {
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
  if (isWorkersAiProvider(provider)) {
    return getModel('cloudflare-workers-ai', model as never) ?? fallbackModel('cloudflare-workers-ai', model)
  }
  throw new Error(`Unsupported AMA runtime provider: ${provider}`)
}

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

// Binds the env-bound cloud sandbox host behind the SandboxRuntimeHost port.
// The free functions above stay exported for the current runtime callers (via
// the session-runtime shim); this factory is the Deps-wired surface.
export function createSandboxRuntimeHost(env: Env): SandboxRuntimeHost {
  return {
    startCloudSession(input) {
      return startSessionRuntime(env, input)
    },
    stopCloudSession(sandboxId) {
      return stopSessionRuntime(env, sandboxId)
    },
    executeToolCalls(input) {
      return executeRuntimeToolCalls(env, input)
    },
    runTurn(input) {
      return runSessionTurn(env, input)
    },
  }
}
