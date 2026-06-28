// Smoke test for the runner-side runtime surface.
//
// AMA is intentionally not a runner-loop runtime: the cloud owns the Pi loop and
// a self-hosted runner only provides the sandbox executor. This smoke keeps that
// boundary explicit by exercising the external SDK bridge in deterministic test
// mode and asserting that the bridge no longer accepts `ama` as a provider.
//
//   node scripts/smoke-runtime.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'

const BUNDLE = join(process.cwd(), 'cmd', 'ama-runner', 'pkg', 'runtimebridge', 'bundle.mjs')
let passed = 0
let failed = 0

const ok = (name, cond, detail = '') => {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` ${detail}` : ''}`)
  }
}

function startBridge() {
  const child = spawn('node', [BUNDLE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AMA_RUNTIME_BRIDGE_TEST_MODE: '1' },
  })
  const events = []
  const outputs = []
  const waiters = []

  const notify = () => {
    for (const waiter of waiters.slice()) {
      if (waiter.pred()) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve()
      }
    }
  }

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    outputs.push(msg)
    if (msg.type === 'sessionEvent') {
      events.push({
        type: msg.eventType,
        payload: msg.payload,
        ...(msg.metadata ? { metadata: msg.metadata } : {}),
      })
    }
    notify()
  })
  child.stderr.on('data', () => {})

  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`)
  const until = (pred, ms = 10000) =>
    new Promise((resolve, reject) => {
      if (pred()) return resolve()
      const waiter = { pred, resolve }
      waiters.push(waiter)
      setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error(`timeout after ${ms}ms`))
      }, ms)
    })
  const waitReady = (ms = 5000) => until(() => outputs.some((message) => message.type === 'ready'), ms)
  const waitForResult = (requestId, ms = 10000) =>
    until(() => outputs.some((message) => message.type === 'result' && message.requestId === requestId), ms)
  const waitForError = (requestId, ms = 10000) =>
    until(() => outputs.some((message) => message.type === 'error' && message.requestId === requestId), ms)
  const waitForEventCount = (type, n, ms = 10000) => until(() => events.filter((event) => event.type === type).length >= n, ms)

  return {
    child,
    events,
    outputs,
    send,
    waitReady,
    waitForResult,
    waitForError,
    waitForEventCount,
    stop: () => {
      if (child.exitCode === null) child.kill()
    },
  }
}

const requestBase = (runtime, requestId, overrides = {}) => ({
  type: 'run',
  requestId,
  runtime,
  sessionId: requestId,
  cwd: mkdtempSync(join(tmpdir(), `ama-${runtime}-smoke-`)),
  env: {},
  prompt: `Smoke ${runtime}.`,
  provider: `provider_${runtime}`,
  model: `${runtime}-model`,
  runtimeConfig: { e2eBridgeTest: true },
  agentSnapshot: { instructions: 'Smoke test agent.' },
  ...overrides,
})

async function bridgeInventory() {
  console.log('\n[bridge] runtime inventory')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'inventory_all'
  bridge.send({ type: 'inventory', requestId, env: {}, includeUsage: true })
  await bridge.waitForResult(requestId)
  const result = bridge.outputs.find((message) => message.requestId === requestId && message.type === 'result')?.result
  const runtimes = Array.isArray(result?.runtimes) ? result.runtimes : []
  for (const runtime of ['codex', 'claude-code', 'copilot']) {
    const entry = runtimes.find((item) => item.runtime === runtime)
    ok(`${runtime} inventory entry`, Boolean(entry), `(result=${JSON.stringify(result)})`)
    ok(`${runtime} installed in test mode`, entry?.installed === true)
    ok(`${runtime} reports models or fallback`, Boolean(entry?.models?.length || entry?.fallbackModels?.length))
  }
  bridge.stop()
}

async function deterministicRun(runtime) {
  console.log(`\n[${runtime}] deterministic bridge run`)
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = `run_${runtime.replace(/[^a-z0-9]/gi, '_')}`
  bridge.send(requestBase(runtime, requestId))
  await bridge.waitForResult(requestId)
  const types = bridge.events.map((event) => event.type)
  const result = bridge.outputs.find((message) => message.requestId === requestId && message.type === 'result')?.result
  ok('emitted turn_start', types.includes('turn_start'))
  ok('emitted assistant message', types.includes('message_end'))
  ok('emitted sandbox tool events', types.includes('tool_execution_start') && types.includes('tool_execution_end'))
  ok('emitted usage.recorded', types.includes('usage.recorded'))
  ok('emitted turn_end', types.includes('turn_end'))
  ok('returned resume token', typeof result?.resumeToken === 'string' && result.resumeToken.length > 0)
  bridge.stop()
}

async function liveRunWithPrompt() {
  console.log('\n[claude-code] live bridge controls')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'run_claude_live'
  bridge.send(
    requestBase('claude-code', requestId, {
      runtimeConfig: { e2eBridgeTest: true, e2eBridgeLive: true },
      model: 'claude-sonnet-4-6',
    }),
  )
  await bridge.waitForEventCount('message_end', 1)
  bridge.send({ type: 'send', requestId, message: 'Follow-up prompt.' })
  await bridge.waitForEventCount('message_end', 2)
  bridge.send({ type: 'abort', requestId })
  await bridge.waitForResult(requestId)
  const messagePayload = bridge.events
    .filter((event) => event.type === 'message_end')
    .map((event) => JSON.stringify(event.payload))
    .join('\n')
  ok('initial prompt reached live runtime', messagePayload.includes('received:Smoke claude-code.'))
  ok('follow-up prompt reached live runtime', messagePayload.includes('live-received:Follow-up prompt.'))
  ok('abort completed the live run', bridge.events.some((event) => event.type === 'turn_end'))
  bridge.stop()
}

async function livePermissionFlow() {
  console.log('\n[copilot] permission bridge controls')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'run_copilot_permission'
  bridge.send(
    requestBase('copilot', requestId, {
      runtimeConfig: {
        e2eBridgeTest: true,
        e2eBridgeLive: true,
        e2eBridgePermission: { action: 'shell', command: 'printf permission-ok' },
      },
      model: 'copilot-cli',
    }),
  )
  await bridge.waitForEventCount('permission.request', 1)
  const permission = bridge.events.find((event) => event.type === 'permission.request')?.payload
  bridge.send({ type: 'permissionDecision', requestId, permissionId: permission?.permissionId, allowed: true })
  await bridge.waitForEventCount('tool_execution_end', 1)
  bridge.send({ type: 'abort', requestId })
  await bridge.waitForResult(requestId)
  const payloads = bridge.events.map((event) => JSON.stringify(event.payload)).join('\n')
  ok('permission request emitted', typeof permission?.permissionId === 'string' && permission.permissionId.length > 0)
  ok('approved permission executed sandbox tool', payloads.includes('permission-ok'))
  bridge.stop()
}

async function amaRejectedByBridge() {
  console.log('\n[ama] cloud-loop boundary')
  const bridge = startBridge()
  await bridge.waitReady()
  const requestId = 'run_ama_rejected'
  bridge.send(requestBase('ama', requestId, { runtimeConfig: {} }))
  await bridge.waitForError(requestId)
  const error = bridge.outputs.find((message) => message.requestId === requestId && message.type === 'error')?.error
  ok('ama is not a runner SDK bridge provider', String(error?.message ?? '').includes('Unsupported runtime provider: ama'))
  bridge.stop()
}

async function main() {
  console.log(`Smoke testing runner runtime bridge: ${BUNDLE}`)
  await bridgeInventory()
  await deterministicRun('codex')
  await liveRunWithPrompt()
  await livePermissionFlow()
  await amaRejectedByBridge()
  console.log(`\n=== smoke: ${passed} passed, ${failed} failed ===`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('smoke harness error:', error)
  process.exit(2)
})
