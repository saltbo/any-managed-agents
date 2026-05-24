import type { Env } from '../../env'

export interface PiBridgeStartInput {
  sessionId: string
  sandboxId: string
  provider: string
  model: string
  agentSnapshot: Record<string, unknown>
  environmentSnapshot: Record<string, unknown> | null
  mcpSnapshot?: Record<string, unknown>
}

export interface PiBridgeStartResult {
  sandboxId: string
  piRuntimeId: string
  piProcessId: string
  runtimeEndpointPath: string
  metadata: Record<string, unknown>
}

export interface SafeRuntimeError {
  type: 'runtime_error'
  message: string
  code?: string
}

const DEFAULT_BRIDGE_PORT = 8788
const PI_PROVIDER_NAMES: Record<string, string> = {
  'workers-ai': 'cloudflare-workers-ai',
}

async function getSandboxBinding() {
  const { getSandbox } = await import('@cloudflare/sandbox')
  return getSandbox
}

function bridgePort(env: Env) {
  return Number(env.AMA_PI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT)
}

export function runtimeEndpointPath(sessionId: string) {
  return `/runtime/sessions/${sessionId}/rpc`
}

function piProviderName(provider: string) {
  return PI_PROVIDER_NAMES[provider] ?? provider
}

export function safeRuntimeError(error: unknown): SafeRuntimeError {
  if (error instanceof Error) {
    return {
      type: 'runtime_error',
      message: error.message,
      ...(error.name ? { code: error.name } : {}),
    }
  }
  return { type: 'runtime_error', message: String(error) }
}

export async function startPiBridge(env: Env, input: PiBridgeStartInput): Promise<PiBridgeStartResult> {
  if (env.AMA_RUNTIME_MODE === 'test') {
    return {
      sandboxId: input.sandboxId,
      piRuntimeId: `pi_${input.sessionId}`,
      piProcessId: `proc_${input.sessionId}`,
      runtimeEndpointPath: runtimeEndpointPath(input.sessionId),
      metadata: { runtimeMode: 'test', bridge: 'fake' },
    }
  }

  const port = bridgePort(env)
  const provider = piProviderName(input.provider)
  const command =
    env.AMA_PI_BRIDGE_COMMAND ??
    `node /opt/ama/pi-bridge.mjs --port ${port} --session-id ${input.sessionId} --provider ${provider} --model ${input.model}`
  const getSandbox = await getSandboxBinding()
  const sandbox = getSandbox(env.SANDBOX, input.sandboxId, {
    keepAlive: true,
    normalizeId: true,
    containerTimeouts: { instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 180_000 },
  })

  try {
    await sandbox.exec('mkdir -p /workspace/.ama')
    await sandbox.writeFile(
      '/workspace/.ama/session.json',
      JSON.stringify({
        sessionId: input.sessionId,
        sandboxId: input.sandboxId,
        provider: input.provider,
        model: input.model,
        agentSnapshot: input.agentSnapshot,
        environmentSnapshot: input.environmentSnapshot,
        mcpSnapshot: input.mcpSnapshot ?? { connectors: [] },
      }),
      { encoding: 'utf-8' },
    )

    const process = await sandbox.startProcess(command, {
      cwd: '/workspace',
      env: {
        AMA_SESSION_ID: input.sessionId,
        AMA_SANDBOX_ID: input.sandboxId,
        PI_PROVIDER: provider,
        PI_MODEL: input.model,
        CLOUDFLARE_ACCOUNT_ID: env.AMA_WORKERS_AI_ACCOUNT_ID,
        CLOUDFLARE_API_KEY: env.AMA_WORKERS_AI_API_KEY ?? env.AMA_WORKERS_AI_API_TOKEN,
        CLOUDFLARE_AI_GATEWAY_ID: env.AMA_AI_GATEWAY_ID,
      },
      processId: `pi-${input.sessionId}`,
      autoCleanup: false,
    })
    await process.waitForPort(port, { path: '/health' })

    return {
      sandboxId: input.sandboxId,
      piRuntimeId: process.id,
      piProcessId: String(process.pid),
      runtimeEndpointPath: runtimeEndpointPath(input.sessionId),
      metadata: { bridgePort: port, bridgeCommand: command },
    }
  } catch (error) {
    await sandbox.destroy()
    throw error
  }
}

export async function stopPiBridge(env: Env, sandboxId: string, piRuntimeId: string | null) {
  if (env.AMA_RUNTIME_MODE === 'test') {
    return
  }

  const getSandbox = await getSandboxBinding()
  const sandbox = getSandbox(env.SANDBOX, sandboxId, { keepAlive: true, normalizeId: true })
  if (piRuntimeId) {
    await sandbox.killProcess(piRuntimeId)
  } else {
    await sandbox.killAllProcesses()
  }
  await sandbox.destroy()
}

export async function proxyPiRuntime(env: Env, sandboxId: string, request: Request) {
  if (env.AMA_RUNTIME_MODE === 'test') {
    const url = new URL(request.url)
    return Response.json({
      sandboxId,
      path: url.pathname.replace(/^\/runtime\/sessions\/[^/]+/, '') || '/',
      proxy: 'pi',
    })
  }

  const getSandbox = await getSandboxBinding()
  const sandbox = getSandbox(env.SANDBOX, sandboxId, { keepAlive: true, normalizeId: true })
  const upstreamUrl = new URL(request.url)
  upstreamUrl.pathname = upstreamUrl.pathname.replace(/^\/runtime\/sessions\/[^/]+/, '') || '/'

  const upstreamHeaders = new Headers(request.headers)
  upstreamHeaders.delete('cookie')
  upstreamHeaders.delete('authorization')
  upstreamHeaders.set('x-ama-runtime-proxy', 'pi')

  return await sandbox.containerFetch(
    new Request(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.body,
      redirect: 'manual',
    }),
    bridgePort(env),
  )
}
