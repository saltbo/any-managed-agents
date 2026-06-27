import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'
import { assertAmaRuntimeEvent } from './events/ama'
import {
  type AmaRuntimeEvent,
  bridgeError,
  createResumeTokenWatcher,
  type RuntimeBridgeInput,
  type RuntimeBridgeOutput,
  type RuntimeProviderHandle,
} from './protocol'
import { getProvider } from './providers/registry'
import { isE2eBridgeTest, probeFailureStatus, runE2eBridgeTest, TEST_MODE_RUNTIME_MODELS } from './run-modes'

type ActiveRun = {
  handle?: RuntimeProviderHandle
  done: boolean
}

const active = new Map<string, ActiveRun>()

function write(message: RuntimeBridgeOutput) {
  stdout.write(`${JSON.stringify(message)}\n`)
}

function writeSessionEvent(requestId: string, event: AmaRuntimeEvent) {
  const canonical = assertAmaRuntimeEvent(event)
  write({
    type: 'sessionEvent',
    requestId,
    eventType: canonical.type,
    payload: canonical.payload,
    ...(canonical.metadata ? { metadata: canonical.metadata } : {}),
  })
}

function parseInput(line: string): RuntimeBridgeInput | null {
  const record = JSON.parse(line) as RuntimeBridgeInput
  if (!record || typeof record !== 'object' || !('type' in record)) {
    throw new Error('Bridge input must be an object with type')
  }
  return record
}

async function run(request: Extract<RuntimeBridgeInput, { type: 'run' }>) {
  const state: ActiveRun = { done: false }
  active.set(request.requestId, state)
  try {
    if (isE2eBridgeTest(request)) {
      await runE2eBridgeTest(request, state, write)
      return
    }
    const provider = getProvider(request.runtime)
    const handle = await provider.execute(request)
    state.handle = handle
    // Surface the resume token as soon as the provider learns it so the runner
    // can persist it via lease renewals; waiting for the final result message
    // loses the token when the runner is interrupted mid-run.
    const emitResumeToken = createResumeTokenWatcher(handle, (resumeToken) => {
      write({ type: 'resumeToken', requestId: request.requestId, resumeToken })
    })
    emitResumeToken()
    for await (const event of handle.events) {
      writeSessionEvent(request.requestId, event)
      emitResumeToken()
    }
    write({ type: 'result', requestId: request.requestId, result: { resumeToken: handle.getResumeToken?.() } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    write({ type: 'error', requestId: request.requestId, error: bridgeError(message, 'runtime_bridge_error') })
  } finally {
    state.done = true
    active.delete(request.requestId)
  }
}

async function fetchUsage(request: Extract<RuntimeBridgeInput, { type: 'fetchUsage' }>) {
  try {
    const provider = getProvider(request.runtime)
    const windows = provider.fetchUsage ? await provider.fetchUsage({ env: request.env }) : null
    write({ type: 'result', requestId: request.requestId, result: { windows: windows ?? null } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    write({ type: 'error', requestId: request.requestId, error: bridgeError(message, 'runtime_usage_error') })
  }
}

async function detectModels(request: Extract<RuntimeBridgeInput, { type: 'detectModels' }>) {
  try {
    if (process.env.AMA_RUNTIME_BRIDGE_TEST_MODE === '1') {
      write({
        type: 'result',
        requestId: request.requestId,
        result: {
          models: TEST_MODE_RUNTIME_MODELS[request.runtime] ?? null,
          status: 'ready',
          version: 'bridge-test',
          detail: 'deterministic bridge test runtime',
        },
      })
      return
    }
    const provider = getProvider(request.runtime)
    const models = provider.listModels ? await provider.listModels({ env: request.env }) : null
    write({
      type: 'result',
      requestId: request.requestId,
      result:
        models && models.length > 0
          ? { models, status: 'ready', detail: `host CLI enumerated ${models.length} models` }
          : {
              models: null,
              status: 'unauthenticated',
              detail: 'host CLI exposed no models; authenticate the runtime CLI',
            },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    write({
      type: 'result',
      requestId: request.requestId,
      result: { models: null, status: probeFailureStatus(message), detail: 'host model enumeration failed' },
    })
  }
}

async function control(message: Exclude<RuntimeBridgeInput, { type: 'run' | 'fetchUsage' | 'detectModels' }>) {
  const state = active.get(message.requestId)
  if (!state?.handle) {
    write({
      type: 'error',
      requestId: message.requestId,
      error: bridgeError('No active runtime request', 'no_active_request'),
    })
    return
  }
  if (message.type === 'abort') {
    await state.handle.abort()
    return
  }
  if (message.type === 'permissionDecision') {
    await state.handle.resolvePermission?.(message.permissionId ?? '', message.allowed === true, message.reason)
    return
  }
  try {
    await state.handle.send(message.message ?? '')
  } catch (err) {
    // A rejected mid-run send must not kill the active run; surface it as a
    // diagnostic so the prompt loss is observable in the session events.
    const reason = err instanceof Error ? err.message : String(err)
    writeSessionEvent(message.requestId, {
      type: 'runtime.output',
      payload: { stream: 'bridge', content: `Runtime rejected injected prompt: ${reason}` },
    })
  }
}

write({ type: 'ready' })

const lines = createInterface({ input: stdin, crlfDelay: Number.POSITIVE_INFINITY })
lines.on('line', (line) => {
  if (!line.trim()) return
  void (async () => {
    try {
      const message = parseInput(line)
      if (!message) return
      if (message.type === 'run') {
        await run(message)
      } else if (message.type === 'fetchUsage') {
        await fetchUsage(message)
      } else if (message.type === 'detectModels') {
        await detectModels(message)
      } else {
        await control(message)
      }
    } catch (err) {
      write({
        type: 'error',
        requestId: 'unknown',
        error: bridgeError(err instanceof Error ? err.message : String(err), 'invalid_bridge_input'),
      })
    }
  })()
})
