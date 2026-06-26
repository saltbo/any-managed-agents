import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getModel, type Model } from '@earendil-works/pi-ai'
import { normalizeMemoryPath } from '@server/domain/memory-store'
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
import type { ToolExecutor } from '../../../runtime-core/ports'
import { runTurn, runtimeMessagesFromEvents } from '../../../runtime-core/turn-engine'
import { canonicalProvider } from '../../domain/runtime/provider'
import type { Env } from '../../env'
import type { RuntimeSecretEnvEntry } from '../gateways/runtime-secret-env'
import { toolExecutor } from './sandbox-tool-executor'
import { workersAiModelClient } from './workers-ai-model-client'
import type { RunnerChannel } from '@server/usecases/ports'

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
  const githubResources = resourceRefs
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
  const memoryStoreResources = resourceRefs
    .filter((resourceRef) => resourceRef.type === 'memory_store')
    .map((resourceRef) => ({
      type: 'memory_store',
      storeId: resourceRef.storeId,
      name: resourceRef.name,
      description: resourceRef.description ?? null,
      access: resourceRef.access,
      mountPath: resourceRef.mountPath,
      memories: Array.isArray(resourceRef.memories)
        ? resourceRef.memories.map((memory) => ({
            path: typeof memory === 'object' && memory ? (memory as Record<string, unknown>).path : null,
          }))
        : [],
      status: 'declared',
    }))
    .sort((left, right) => String(left.mountPath).localeCompare(String(right.mountPath)))
  return {
    version: 1,
    workspaceRoot: '/workspace',
    resources: [...githubResources, ...memoryStoreResources],
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
  const githubResources = manifest.resources.filter((resource) => resource.type === 'github_repository') as Array<
    Record<string, unknown>
  >
  for (const resource of githubResources) {
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
  for (const resourceRef of values.resourceRefs.filter((resourceRef) => resourceRef.type === 'memory_store')) {
    const mountPath = String(resourceRef.mountPath ?? '')
    if (!mountPath.startsWith('/workspace/.ama/memory-stores/')) {
      throw new Error(`Invalid memory_store mount path: ${mountPath}`)
    }
    await execOrThrow(sandbox, `mkdir -p ${shellQuote(mountPath)}`)
    const memories = Array.isArray(resourceRef.memories) ? resourceRef.memories : []
    for (const memory of memories) {
      if (!memory || typeof memory !== 'object') {
        continue
      }
      const record = memory as Record<string, unknown>
      const path = String(record.path ?? '')
      const content = String(record.content ?? '')
      if (!path || path.startsWith('/') || path.includes('..')) {
        throw new Error(`Invalid memory path: ${path}`)
      }
      const fullPath = `${mountPath}/${path}`
      const parentPath = fullPath.slice(0, fullPath.lastIndexOf('/'))
      await execOrThrow(sandbox, `mkdir -p ${shellQuote(parentPath)}`)
      await sandbox.writeFile(fullPath, content, { encoding: 'utf-8' })
    }
    if (resourceRef.access === 'read_only') {
      await execOrThrow(sandbox, `chmod -R a-w ${shellQuote(mountPath)}`)
    }
    const declared = manifest.resources.find(
      (resource) =>
        resource.type === 'memory_store' && 'storeId' in resource && resource.storeId === resourceRef.storeId,
    )
    resources.push({ ...(declared ?? resourceRef), mountPath, status: 'mounted' })
  }
  await sandbox.writeFile('/workspace/.ama/resources.json', JSON.stringify({ ...manifest, resources }), {
    encoding: 'utf-8',
  })
}

export async function startSessionRuntime(
  env: Env,
  input: SessionRuntimeStartInput,
): Promise<SessionRuntimeStartResult> {
  const model = resolveRuntimeModel(env, input.model)
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

export async function readMemoryStoreMemories(
  env: Env,
  input: { sandboxId: string; resourceRefs: Record<string, unknown>[] },
) {
  if (env.AMA_RUNTIME_MODE === 'test') {
    return []
  }
  const getSandbox = await getSandboxBinding()
  const sandbox = getSandbox(env.SANDBOX, input.sandboxId, { keepAlive: true, normalizeId: true })
  const stores: Array<{ storeId: string; memories: Array<{ path: string; content: string }> }> = []
  for (const resourceRef of input.resourceRefs) {
    if (resourceRef.type !== 'memory_store' || resourceRef.access !== 'read_write') {
      continue
    }
    const storeId = String(resourceRef.storeId ?? '')
    const mountPath = String(resourceRef.mountPath ?? '')
    if (!storeId || !mountPath.startsWith('/workspace/.ama/memory-stores/')) {
      continue
    }
    const listed = await sandbox.exec(`find ${shellQuote(mountPath)} -type f -print | sort`)
    if (typeof listed.exitCode === 'number' && listed.exitCode !== 0) {
      throw new Error(`Memory store readback failed: ${listed.stderr || listed.stdout || storeId}`)
    }
    const memories = []
    for (const filePath of (listed.stdout ?? '').split('\n').filter(Boolean)) {
      if (!filePath.startsWith(`${mountPath}/`)) {
        continue
      }
      const relativePath = normalizeMemoryPath(filePath.slice(mountPath.length + 1))
      const content = await sandbox.exec(`cat ${shellQuote(filePath)}`)
      if (typeof content.exitCode === 'number' && content.exitCode !== 0) {
        throw new Error(`Memory file readback failed: ${content.stderr || relativePath}`)
      }
      memories.push({ path: relativePath, content: content.stdout ?? '' })
    }
    stores.push({ storeId, memories })
  }
  return stores
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

function runtimeDefaultModel(env: Env) {
  return env.AMA_DEFAULT_MODEL ?? '@cf/moonshotai/kimi-k2.6'
}

function resolveRuntimeModel(env: Env, model: string | null) {
  return model ?? runtimeDefaultModel(env)
}

function fallbackModel(model: string): Model<string> {
  return {
    id: model,
    name: model,
    api: 'ama-workers-ai',
    provider: 'cloudflare-workers-ai',
    baseUrl: 'cloudflare-ai-binding://AI',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  }
}

// Cloud dispatches every model through the Workers AI binding (env.AI.run): the
// model id drives native (@cf) vs AI Gateway routing, so the agent's vendor is
// irrelevant here — every cloud model resolves against the workers-ai api.
function runtimeModel(model: string) {
  return getModel('cloudflare-workers-ai', model as never) ?? fallbackModel(model)
}

// Worker host adapter over the shared turn engine: resolve the Workers AI
// model, build the Cloudflare tool executor and model client, and map the
// optional SessionTurnInput callbacks to the engine's ports (absent callbacks
// become permissive defaults — no gating, no liveness check, never pause).
export async function runSessionTurn(
  env: Env,
  input: SessionTurnInput,
  executor = toolExecutor(env),
): Promise<SessionTurnResult> {
  const provider = piProviderName(input.provider)
  const modelId = resolveRuntimeModel(env, input.model)
  const model = runtimeModel(modelId)
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
    executor,
    modelClient: workersAiModelClient(env),
  })
}

// Binds the env-bound cloud sandbox host behind the SandboxRuntimeHost port.
// The free functions above stay exported for the current runtime callers (via
// the session-runtime shim); this factory is the Deps-wired surface.
export function createSandboxRuntimeHost(
  env: Env,
  options: {
    runnerChannel?: RunnerChannel
    resolveSandboxBackend?: (sessionId: string) => Promise<string | null>
  } = {},
): SandboxRuntimeHost {
  const cloudExecutor = toolExecutor(env)
  const executorForSession = async (sessionId: string) => {
    const backend = await options.resolveSandboxBackend?.(sessionId)
    if (backend === 'runner-sandbox') {
      if (!options.runnerChannel) {
        throw new Error('Runner sandbox channel is not configured')
      }
      return { execute: (input) => options.runnerChannel!.executeSandboxTool(input) } satisfies ToolExecutor
    }
    return cloudExecutor
  }

  return {
    startCloudSession(input) {
      return startSessionRuntime(env, input)
    },
    async readMemoryStoreMemories(input) {
      if ((await options.resolveSandboxBackend?.(input.sessionId)) === 'runner-sandbox') {
        if (!options.runnerChannel) {
          throw new Error('Runner sandbox channel is not configured')
        }
        return await options.runnerChannel.readMemoryStoreMemories({
          sessionId: input.sessionId,
          resourceRefs: input.resourceRefs,
        })
      }
      return readMemoryStoreMemories(env, input)
    },
    stopCloudSession(sandboxId) {
      return stopSessionRuntime(env, sandboxId)
    },
    async executeToolCalls(input) {
      if ((await options.resolveSandboxBackend?.(input.sessionId)) === 'runner-sandbox') {
        const body = input.body as { toolCalls?: RuntimeToolCall[] }
        const calls = runtimeToolCalls(body)
        const results = []
        for (const [index, call] of calls.entries()) {
          results.push(
            await (await executorForSession(input.sessionId)).execute({
              sessionId: input.sessionId,
              sandboxId: input.sandboxId,
              toolCallId: typeof call.id === 'string' ? call.id : `tool_${index + 1}`,
              toolName: typeof call.name === 'string' ? call.name : 'tool',
              input: call.input ?? {},
              cwd: '/workspace',
            }),
          )
        }
        return results
      }
      return executeRuntimeToolCalls(env, input)
    },
    async executeTool(input) {
      return await (await executorForSession(input.sessionId)).execute(input)
    },
    async runTurn(input) {
      return await runSessionTurn(env, input, await executorForSession(input.sessionId))
    },
  }
}
