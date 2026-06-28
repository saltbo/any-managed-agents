import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getModel, type Model } from '@earendil-works/pi-ai'
import { normalizeMemoryPath } from '@server/domain/memory-store'
import { runtimeEndpointPath } from '@server/domain/runtime/driver'
import {
  isGitHubRepositoryVolume,
  isMemoryStoreVolume,
  type MemoryStoreVolume,
  type Volume,
  type VolumeMount,
  volumeMountPath,
} from '@server/domain/runtime/execution-inputs'
import type {
  AmaTurnExecutor,
  CloudRuntimeLifecycle,
  ResolvedVolumeMount,
  RunnerChannel,
  RuntimeWorkspaceReader,
  SessionSandboxExecutor,
} from '@server/usecases/ports'
import { canonicalProvider } from '../../domain/runtime/provider'
import type { Env } from '../../env'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  RuntimeTurnCancelledError,
} from '../../usecases/runtime/engine/errors'
import type {
  RuntimeToolPolicyDecision,
  RuntimeToolPolicyInput,
  ToolExecutor,
} from '../../usecases/runtime/engine/ports'
import { runTurn, runtimeMessagesFromEvents } from '../../usecases/runtime/engine/turn-engine'
import { toolExecutor } from './sandbox-tool-executor'
import { workersAiModelClient } from './workers-ai-model-client'

// Canonical home is the AMA turn engine; re-exported so existing importers keep
// their import paths.
export type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput }
// The turn engine, ports, and error vocabulary live under
// server/usecases/runtime/engine. This module is the Worker host: it
// resolves the model, builds the Cloudflare tool executor and the Workers AI
// model client, maps the SessionTurnInput callbacks to ports, and owns
// cloud-only sandbox start/stop and workspace preparation.
// Canonical home is the AMA turn engine; re-exported for existing importers.
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
  volumes?: Volume[]
  volumeMounts?: VolumeMount[]
  runtimeEnv?: Record<string, string>
  resolvedVolumes?: ResolvedVolumeMount[]
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

export function workspaceVolumeManifest(volumes: Volume[] = [], volumeMounts: VolumeMount[] = []) {
  const githubVolumes = volumes
    .filter(isGitHubRepositoryVolume)
    .map((volume) => ({
      type: 'github_repository',
      name: volume.name,
      owner: volume.owner,
      repo: volume.repo,
      mountPath: volumeMountPath(volume.name, volumeMounts),
      ...(typeof volume.ref === 'string' ? { ref: volume.ref } : {}),
      // The unified { credentialId, versionId? } reference passes through as
      // declarative metadata; the workspace resolves the git token from env.
      ...(volume.credentialRef ? { credentialRef: volume.credentialRef } : {}),
      status: 'declared',
    }))
    .sort((left, right) => String(left.mountPath).localeCompare(String(right.mountPath)))
  const memoryStoreVolumes = volumes
    .filter(isMemoryStoreVolume)
    .map((volume) => ({
      type: 'memory_store',
      storeId: volume.storeId,
      name: volume.name,
      description: volume.description ?? null,
      access: volume.access,
      mountPath: volumeMountPath(volume.name, volumeMounts),
      memories: Array.isArray(volume.memories)
        ? volume.memories.map((memory) => ({
            path: typeof memory === 'object' && memory ? (memory as Record<string, unknown>).path : null,
          }))
        : [],
      status: 'declared',
    }))
    .sort((left, right) => String(left.mountPath).localeCompare(String(right.mountPath)))
  return {
    version: 1,
    workspaceRoot: '/workspace',
    volumes: [...githubVolumes, ...memoryStoreVolumes],
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
// github_repository volumes so the agent starts with a ready workspace.
async function prepareCloudWorkspace(
  sandbox: CloudWorkspaceSandbox,
  values: {
    volumes: Volume[]
    volumeMounts: VolumeMount[]
    env: Record<string, string>
    resolvedVolumes: ResolvedVolumeMount[]
  },
) {
  const manifest = workspaceVolumeManifest(values.volumes, values.volumeMounts)
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

  const githubVolumes = manifest.volumes.filter((volume) => volume.type === 'github_repository') as Array<
    Record<string, unknown>
  >
  for (const volume of githubVolumes) {
    const owner = String(volume.owner ?? '')
    const repo = String(volume.repo ?? '')
    if (!GITHUB_NAME_RE.test(owner) || !GITHUB_NAME_RE.test(repo)) {
      throw new Error(`Invalid github_repository volume: ${owner}/${repo}`)
    }
    const mountPath =
      typeof volume.mountPath === 'string' && volume.mountPath ? volume.mountPath : `/workspace/repos/${owner}/${repo}`
    if (!mountPath.startsWith('/workspace/')) {
      throw new Error(`github_repository mountPath must stay under /workspace: ${mountPath}`)
    }
    await execOrThrow(sandbox, `git clone https://github.com/${owner}/${repo}.git ${shellQuote(mountPath)}`, {
      timeout: GIT_CLONE_TIMEOUT_MS,
    })
    if (typeof volume.ref === 'string' && volume.ref) {
      await execOrThrow(sandbox, `git -C ${shellQuote(mountPath)} checkout ${shellQuote(volume.ref)}`)
    }
  }
  for (const volume of values.volumes.filter(isMemoryStoreVolume)) {
    const mountPath = String(
      volumeMountPath(volume.name, values.volumeMounts) ?? `/workspace/.ama/memory-stores/${volume.storeId}`,
    )
    if (!mountPath.startsWith('/workspace/.ama/memory-stores/')) {
      throw new Error(`Invalid memory_store mount path: ${mountPath}`)
    }
    await execOrThrow(sandbox, `mkdir -p ${shellQuote(mountPath)}`)
    const memories = Array.isArray(volume.memories) ? volume.memories : []
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
    if (volume.access === 'read_only') {
      await execOrThrow(sandbox, `chmod -R a-w ${shellQuote(mountPath)}`)
    }
  }
  for (const volume of values.resolvedVolumes) {
    const mountPath = volume.mountPath
    if (!mountPath.startsWith('/workspace/')) {
      throw new Error(`Invalid secret volume mount path: ${mountPath}`)
    }
    await execOrThrow(sandbox, `mkdir -p ${shellQuote(mountPath)}`)
    for (const file of volume.files) {
      const path = file.path
      const content = file.content
      if (!path || path.startsWith('/') || path.includes('..')) {
        throw new Error(`Invalid secret volume file path: ${path}`)
      }
      const fullPath = `${mountPath}/${path}`
      const parentPath = fullPath.slice(0, fullPath.lastIndexOf('/'))
      await execOrThrow(sandbox, `mkdir -p ${shellQuote(parentPath)}`)
      await sandbox.writeFile(fullPath, content, { encoding: 'utf-8' })
    }
    if (volume.readOnly) {
      await execOrThrow(sandbox, `chmod -R a-w ${shellQuote(mountPath)}`)
    }
  }
}

export async function startSessionRuntime(
  env: Env,
  input: SessionRuntimeStartInput,
): Promise<SessionRuntimeStartResult> {
  resolveRuntimeModel(env, input.model)
  if (env.AMA_RUNTIME_MODE !== 'test') {
    const getSandbox = await getSandboxBinding()
    const sandbox = getSandbox(env.SANDBOX, input.sandboxId, { keepAlive: true, normalizeId: true })
    const sessionEnv = input.runtimeEnv ?? {}
    if (Object.keys(sessionEnv).length > 0) {
      await sandbox.setEnvVars(sessionEnv)
    }
    await prepareCloudWorkspace(sandbox, {
      volumes: input.volumes ?? [],
      volumeMounts: input.volumeMounts ?? [],
      env: sessionEnv,
      resolvedVolumes: input.resolvedVolumes ?? [],
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
    },
  }
}

export async function stopSessionRuntime(env: Env, sandboxId: string) {
  await toolExecutor(env).stop?.(sandboxId)
}

export async function readMemoryStoreMemories(
  env: Env,
  input: { sandboxId: string; volumes: MemoryStoreVolume[]; volumeMounts: VolumeMount[] },
) {
  if (env.AMA_RUNTIME_MODE === 'test') {
    return []
  }
  const getSandbox = await getSandboxBinding()
  const sandbox = getSandbox(env.SANDBOX, input.sandboxId, { keepAlive: true, normalizeId: true })
  const stores: Array<{ storeId: string; memories: Array<{ path: string; content: string }> }> = []
  for (const volume of input.volumes) {
    if (volume.access !== 'read_write') {
      continue
    }
    const storeId = String(volume.storeId ?? '')
    const mountPath = String(volumeMountPath(volume.name, input.volumeMounts) ?? '')
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

export type RuntimeExecutionAdapters = {
  cloudRuntime: CloudRuntimeLifecycle
  runtimeWorkspace: RuntimeWorkspaceReader
  sandboxExecutor: SessionSandboxExecutor
  amaTurnExecutor: AmaTurnExecutor
}

// Binds env-backed cloud/runner execution behind narrow usecase ports. The
// free functions above stay exported for existing direct importers.
export function createRuntimeExecutionAdapters(
  env: Env,
  options: {
    runnerChannel?: RunnerChannel
    resolveSandboxBackend?: (sessionId: string) => Promise<string | null>
  } = {},
): RuntimeExecutionAdapters {
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
    cloudRuntime: {
      startCloudSession(input) {
        return startSessionRuntime(env, input)
      },
      stopCloudSession(sandboxId) {
        return stopSessionRuntime(env, sandboxId)
      },
    },
    runtimeWorkspace: {
      async readMemoryStoreMemories(input) {
        if ((await options.resolveSandboxBackend?.(input.sessionId)) === 'runner-sandbox') {
          if (!options.runnerChannel) {
            throw new Error('Runner sandbox channel is not configured')
          }
          return await options.runnerChannel.readMemoryStoreMemories({
            sessionId: input.sessionId,
            volumes: input.volumes,
            volumeMounts: input.volumeMounts,
          })
        }
        return readMemoryStoreMemories(env, input)
      },
    },
    sandboxExecutor: {
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
    },
    amaTurnExecutor: {
      async runTurn(input) {
        return await runSessionTurn(env, input, await executorForSession(input.sessionId))
      },
    },
  }
}
