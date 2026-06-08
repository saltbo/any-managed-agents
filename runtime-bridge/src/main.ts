import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { assertAmaRuntimeEvent, runtimeError, runtimeEvent, textMessage, toolEnd, toolStart, usageEvent } from './events/ama'
import { getProvider } from './providers/registry'
import { bridgeError, type AmaRuntimeEvent, type RuntimeBridgeInput, type RuntimeBridgeOutput, type RuntimeProviderHandle } from './protocol'

type ActiveRun = {
  handle?: RuntimeProviderHandle
  done: boolean
}

const active = new Map<string, ActiveRun>()

function write(message: RuntimeBridgeOutput) {
  stdout.write(`${JSON.stringify(message)}\n`)
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
    if (process.env.AMA_RUNTIME_BRIDGE_TEST_MODE === '1' && request.runtimeConfig?.e2eBridgeTest === true) {
      for (const event of deterministicBridgeTestEvents(request)) {
        write({ type: 'event', requestId: request.requestId, event: assertAmaRuntimeEvent(event) })
      }
      write({ type: 'result', requestId: request.requestId, result: { resumeToken: `e2e-${request.sessionId}` } })
      return
    }
    const provider = getProvider(request.runtime)
    const handle = await provider.execute(request)
    state.handle = handle
    for await (const event of handle.events) {
      write({ type: 'event', requestId: request.requestId, event: assertAmaRuntimeEvent(event) })
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

function deterministicBridgeTestEvents(request: Extract<RuntimeBridgeInput, { type: 'run' }>): AmaRuntimeEvent[] {
  const marker = `${request.runtime}-bridge-test`
  const toolCallId = `${request.runtime.replace(/[^a-z0-9]/gi, '_')}_tool`
  const receipt = {
    marker,
    sessionId: request.sessionId,
    runtime: request.runtime,
    provider: request.provider,
    model: request.model,
    prompt: request.prompt,
    workspace: request.cwd,
    workspaceEnv: request.env.AMA_WORKSPACE,
    runtimeConfig: request.runtimeConfig,
    agentSnapshot: request.agentSnapshot,
    hasAmaToken: Object.hasOwn(request.env, 'AMA_TOKEN'),
    leakedToken: Object.values(request.env).includes('raw-secret-value') ? 'raw-secret-value' : null,
    home: request.env.HOME,
    tmpdir: request.env.TMPDIR,
  }
  return [
    runtimeEvent('turn_start', { ...receipt, stage: `${marker}-started`, status: 'running' }),
    runtimeEvent('message_end', { message: textMessage('assistant', `${marker} received:${request.prompt}`) }),
    toolStart(toolCallId, 'sandbox.exec', { command: `printf ${request.runtime}-tool-ok` }),
    toolEnd(
      toolCallId,
      'sandbox.exec',
      { command: `printf ${request.runtime}-tool-ok` },
      { stdout: `${request.runtime}-tool-ok`, stderr: '', exitCode: 0 },
      false,
    ),
    usageEvent({
      provider: request.provider,
      model: request.model,
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    }),
    runtimeEvent('runtime.output', { stream: 'stdout', content: `workspace:${request.cwd}` }),
    runtimeEvent('runtime.output', { stream: 'stdout', content: `${marker}-stdout` }),
    runtimeEvent('runtime.output', { stream: 'stderr', content: `${marker}-stderr` }),
    runtimeError(`${marker} safe diagnostic`, 'bridge_test_diagnostic'),
    runtimeEvent('turn_end', { ...receipt, stage: `${marker}-completed`, status: 'completed' }),
  ]
}

async function control(message: Exclude<RuntimeBridgeInput, { type: 'run' }>) {
  const state = active.get(message.requestId)
  if (!state?.handle) {
    write({ type: 'error', requestId: message.requestId, error: bridgeError('No active runtime request', 'no_active_request') })
    return
  }
  if (message.type === 'abort') {
    await state.handle.abort()
    return
  }
  await state.handle.send(message.message ?? '')
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
