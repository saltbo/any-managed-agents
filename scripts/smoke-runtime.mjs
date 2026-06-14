// Smoke test for the runtime-bridge providers on the refactored runtime core.
// Drives the embedded bridge bundle over stdio (the same protocol the Go runner
// uses) and exercises the AMA provider end-to-end against a local mock
// OpenAI-compatible model, plus a claude-code load/graceful-no-creds check.
//
// AMA is a live-prompt runtime: a run stays alive after each turn waiting for
// mid-run prompts (like claude-code/copilot) and emits its final `result` only
// on abort. So turn completion is observed via the `agent_end` event.
//
//   node scripts/smoke-runtime.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'

const BUNDLE = join(process.cwd(), 'cmd', 'ama-runner', 'runtime_bridge_bundle.mjs')
let passed = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name} ${detail}`)
  }
}

// ── Mock OpenAI-compatible model ──────────────────────────────────────────────
function startMockModel(scripted) {
  let call = 0
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      requests.push(JSON.parse(body || '{}'))
      const response = scripted[call] ??
        scripted.at(-1) ?? {
          choices: [{ message: { role: 'assistant', content: 'Hello from the mock model.' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }
      call++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(response))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests, calls: () => call }))
  })
}

// ── Bridge driver ─────────────────────────────────────────────────────────────
function startBridge() {
  const child = spawn('node', [BUNDLE], { stdio: ['pipe', 'pipe', 'pipe'] })
  const events = []
  const outputs = []
  const waiters = []
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    outputs.push(msg)
    if (msg.type === 'event') events.push(msg.event)
    for (const w of waiters.slice()) {
      if (w.pred()) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve()
      }
    }
  })
  child.stderr.on('data', () => {})
  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`)
  const until = (pred, ms = 10000) =>
    new Promise((resolve, reject) => {
      if (pred()) return resolve()
      const w = { pred, resolve }
      waiters.push(w)
      setTimeout(() => {
        const i = waiters.indexOf(w)
        if (i >= 0) waiters.splice(i, 1)
        reject(new Error('timeout'))
      }, ms)
    })
  const countEvents = (type) => events.filter((e) => e.type === type).length
  const waitForEventCount = (type, n, ms) => until(() => countEvents(type) >= n, ms)
  const waitForResult = (requestId, ms) => until(() => outputs.some((m) => m.type === 'result' && m.requestId === requestId), ms)
  return { child, events, outputs, send, waitForEventCount, waitForResult, countEvents, stop: () => child.kill() }
}

const eventTypes = (events) => events.map((e) => e.type)

async function amaTextTurn() {
  console.log('\n[ama] single text turn')
  const mock = await startMockModel([])
  const bridge = startBridge()
  const cwd = mkdtempSync(join(tmpdir(), 'ama-smoke-'))
  await bridge.waitForEventCount('agent_start', 0, 4000).catch(() => {})
  bridge.send({
    type: 'run',
    requestId: 'run_text',
    runtime: 'ama',
    sessionId: 'smoke_text',
    cwd,
    env: { OPENAI_BASE_URL: `http://127.0.0.1:${mock.port}/v1`, OPENAI_API_KEY: 'test' },
    prompt: 'Say hello.',
    provider: 'openai',
    model: 'gpt-smoke',
  })
  await bridge.waitForEventCount('agent_end', 1)
  const types = eventTypes(bridge.events)
  ok('model was called', mock.calls() >= 1, `(calls=${mock.calls()})`)
  ok('emitted message_start', types.includes('message_start'))
  ok('emitted message_end', types.includes('message_end'))
  ok('emitted usage.recorded', types.includes('usage.recorded'))
  ok('emitted turn_end + agent_end', types.includes('turn_end') && types.includes('agent_end'))
  ok('no runtime.error', !types.includes('runtime.error'), `(got ${[...new Set(types)].join(',')})`)
  const assistantText = bridge.events
    .filter((e) => e.type === 'message_end')
    .map((e) => JSON.stringify(e.payload))
    .join('')
  ok('assistant text surfaced', assistantText.includes('mock model'))
  // Abort → the live run drains and emits its final result.
  bridge.send({ type: 'abort', requestId: 'run_text' })
  const cleanShutdown = await bridge.waitForResult('run_text', 5000).then(() => true).catch(() => false)
  ok('clean result on abort', cleanShutdown)
  bridge.stop()
  mock.server.close()
}

async function amaToolTurn() {
  console.log('\n[ama] tool call (sandbox.exec runs locally)')
  const mock = await startMockModel([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'sandbox.exec', arguments: JSON.stringify({ command: 'echo smoke-ok' }) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 },
    },
    {
      choices: [{ message: { role: 'assistant', content: 'Command done.' } }],
      usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
    },
  ])
  const bridge = startBridge()
  const cwd = mkdtempSync(join(tmpdir(), 'ama-smoke-tool-'))
  await new Promise((r) => setTimeout(r, 300))
  bridge.send({
    type: 'run',
    requestId: 'run_tool',
    runtime: 'ama',
    sessionId: 'smoke_tool',
    cwd,
    env: { OPENAI_BASE_URL: `http://127.0.0.1:${mock.port}/v1`, OPENAI_API_KEY: 'test' },
    prompt: 'Run echo smoke-ok.',
    provider: 'openai',
    model: 'gpt-smoke',
  })
  await bridge.waitForEventCount('agent_end', 1, 14000)
  const types = eventTypes(bridge.events)
  ok('model called twice (tool loop)', mock.calls() >= 2, `(calls=${mock.calls()})`)
  ok('emitted tool_execution_start', types.includes('tool_execution_start'), `(got ${[...new Set(types)].join(',')})`)
  ok('emitted tool_execution_end', types.includes('tool_execution_end'))
  const toolEnd = bridge.events.find((e) => e.type === 'tool_execution_end')
  ok(
    'tool executed locally with output',
    JSON.stringify(toolEnd?.payload ?? {}).includes('smoke-ok'),
    `(payload=${JSON.stringify(toolEnd?.payload).slice(0, 160)})`,
  )
  ok('no runtime.error', !types.includes('runtime.error'))
  bridge.send({ type: 'abort', requestId: 'run_tool' })
  bridge.stop()
  mock.server.close()
}

async function amaMultiTurn() {
  console.log('\n[ama] multi-turn (mid-run prompt injection)')
  const mock = await startMockModel([])
  const bridge = startBridge()
  const cwd = mkdtempSync(join(tmpdir(), 'ama-smoke-multi-'))
  await new Promise((r) => setTimeout(r, 300))
  bridge.send({
    type: 'run',
    requestId: 'run_multi',
    runtime: 'ama',
    sessionId: 'smoke_multi',
    cwd,
    env: { OPENAI_BASE_URL: `http://127.0.0.1:${mock.port}/v1`, OPENAI_API_KEY: 'test' },
    prompt: 'First prompt.',
    provider: 'openai',
    model: 'gpt-smoke',
  })
  await bridge.waitForEventCount('agent_end', 1)
  const afterFirst = mock.calls()
  ok('first turn ran', afterFirst >= 1, `(calls=${afterFirst})`)
  bridge.send({ type: 'send', requestId: 'run_multi', message: 'Second prompt.' })
  const second = await bridge.waitForEventCount('agent_end', 2, 8000).then(() => true).catch(() => false)
  ok('second prompt triggered another turn', second && mock.calls() > afterFirst, `(calls=${mock.calls()})`)
  const secondReq = mock.requests.at(-1)
  const roles = (secondReq?.messages ?? []).map((m) => m.role)
  ok('continuation carried the rebuilt transcript', roles.filter((r) => r === 'assistant').length >= 1, `(roles=${roles.join(',')})`)
  bridge.send({ type: 'abort', requestId: 'run_multi' })
  bridge.stop()
  mock.server.close()
}

async function claudeCodeGraceful() {
  console.log('\n[claude-code] provider loads + graceful without creds')
  const bridge = startBridge()
  const cwd = mkdtempSync(join(tmpdir(), 'cc-smoke-'))
  await new Promise((r) => setTimeout(r, 300))
  bridge.send({
    type: 'run',
    requestId: 'run_cc',
    runtime: 'claude-code',
    sessionId: 'smoke_cc',
    cwd,
    env: {},
    prompt: 'hello',
  })
  // Either it settles (result/error) or it stays a live run without crashing.
  const settled = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 8000)
    const check = setInterval(() => {
      if (bridge.outputs.some((m) => (m.type === 'result' || m.type === 'error') && m.requestId === 'run_cc')) {
        clearTimeout(t)
        clearInterval(check)
        resolve(true)
      }
    }, 100)
  })
  ok('claude-code resolved or stayed live without crashing', settled || bridge.child.exitCode === null)
  ok('bridge process alive', bridge.child.exitCode === null)
  bridge.send({ type: 'abort', requestId: 'run_cc' })
  bridge.stop()
}

async function main() {
  console.log(`Smoke testing bridge: ${BUNDLE}`)
  await amaTextTurn()
  await amaToolTurn()
  await amaMultiTurn()
  await claudeCodeGraceful()
  console.log(`\n=== smoke: ${passed} passed, ${failed} failed ===`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('smoke harness error:', e)
  process.exit(2)
})
