import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import {
  CODEX_E2E_MODEL,
  DEFAULT_AMA_RUNNER_CAPABILITY,
  type E2EState as ProductE2EState,
  runtimeProviderModelCapability,
  startProductAmaRunner,
} from './product-api.steps'
import {
  createAgent,
  createEnvironment,
  createProvider,
  createProviderModel,
  delay,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

const NON_READY_STATUSES = ['missing', 'unauthenticated', 'unauthorized', 'limited', 'unhealthy'] as const

type InventoryWorld = StepsWorld & {
  realRunner?: Json
  diagnosticsRunner?: Json
  nonReadyRunner?: Json
  readyRunner?: Json
  blockedSession?: Json
  codexCapabilities?: string[]
}

function state(world: InventoryWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e
}

function objectValue(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function inventoryByRuntime(runner: Json) {
  const entries = Array.isArray(runner.runtimeInventory) ? (runner.runtimeInventory as Json[]) : []
  return new Map(entries.map((entry) => [String(entry.runtime), entry]))
}

async function heartbeatRunner(e2e: E2EState, runnerId: string, data: Json) {
  return await apiJson<Json>(e2e.page.request, `/api/runners/${runnerId}/heartbeats`, {
    method: 'POST',
    data: { status: 'active', currentLoad: 0, ...data },
  })
}

async function registerCodexRunner(e2e: E2EState, name: string, capabilities: string[]) {
  const runner = await apiJson<Json>(e2e.page.request, '/api/runners', {
    method: 'POST',
    data: { name, environmentId: e2e.environment?.id, capabilities },
  })
  return await heartbeatRunner(e2e, String(runner.id), { capabilities })
}

async function claimLeaseResponse(e2e: E2EState, runnerId: string) {
  return await apiResponse(e2e.page.request, `/api/runners/${runnerId}/leases`, {
    method: 'POST',
    data: { leaseDurationSeconds: 90 },
  })
}

async function sessionWorkItems(e2e: E2EState, sessionId: string) {
  return await apiJson<ListResponse<Json>>(e2e.page.request, `/api/runners/work-items?sessionId=${sessionId}`)
}

// ─── Report runtime inventory and diagnostics from runner heartbeat ──────────

Given('an operator has authenticated ama-runner with AMA', { timeout: 120_000 }, async function (this: InventoryWorld) {
  const e2e = await ensureSignedIn(this)
  e2e.environment = await createEnvironment(e2e, {
    name: `${e2e.runId} inventory env`,
    hostingMode: 'self_hosted',
    networkPolicy: { mode: 'unrestricted' },
  })
})

When('ama-runner sends a heartbeat', { timeout: 180_000 }, async function (this: InventoryWorld) {
  const e2e = state(this)
  const product = e2e as unknown as ProductE2EState
  await startProductAmaRunner(product)
  // `go run` compiles the runner first; wait for the registered runner's first
  // heartbeat to land with a populated runtime inventory.
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const runners = await apiJson<ListResponse<Json>>(
      e2e.page.request,
      `/api/runners?environmentId=${e2e.environment?.id}`,
    )
    const reported = runners.data.find(
      (runner) =>
        runner.lastHeartbeatAt && Array.isArray(runner.runtimeInventory) && runner.runtimeInventory.length > 0,
    )
    if (reported) {
      this.realRunner = reported
      return
    }
    const exitCode = product.runnerProcess?.exitCode
    if (exitCode !== null && exitCode !== undefined) {
      throw new Error(`ama-runner exited before its heartbeat:\n${product.runnerProcess?.runnerOutput.join('')}`)
    }
    await delay(1_000)
  }
  throw new Error('ama-runner did not report a heartbeat with runtime inventory')
})

Then(
  'the heartbeat reports supported runtime, provider, and model combinations',
  async function (this: InventoryWorld) {
    const runner = this.realRunner
    assert.ok(runner, 'the heartbeating runner must be observed')
    const capabilities = Array.isArray(runner.capabilities) ? runner.capabilities.map(String) : []
    assert.ok(capabilities.includes(DEFAULT_AMA_RUNNER_CAPABILITY), 'the embedded ama runtime combination is reported')
    assert.ok(
      capabilities.includes(runtimeProviderModelCapability('codex', '*', CODEX_E2E_MODEL)),
      'the host codex runtime, provider, and model combination is reported',
    )
  },
)

Then(
  'each reported runtime includes version, availability status, and safe diagnostic detail',
  async function (this: InventoryWorld) {
    const runner = this.realRunner
    assert.ok(runner, 'the heartbeating runner must be observed')
    const byRuntime = inventoryByRuntime(runner)
    for (const runtime of ['ama', 'codex', 'claude-code', 'copilot']) {
      const entry = objectValue(byRuntime.get(runtime))
      assert.equal(entry.status, 'ready', `${runtime} reports an availability status`)
      assert.ok(typeof entry.version === 'string' && entry.version.length > 0, `${runtime} reports a version`)
      assert.ok(typeof entry.detail === 'string' && entry.detail.length > 0, `${runtime} reports diagnostic detail`)
    }
    const codex = objectValue(byRuntime.get('codex'))
    assert.equal(codex.version, 'bridge-test', 'the host probe version comes from the runtime bridge')
    assert.equal(codex.detail, 'deterministic bridge test runtime')
  },
)

Then(
  'statuses distinguish ready, missing executable, unauthenticated, unauthorized, limited, and unhealthy runtimes',
  async function (this: InventoryWorld) {
    const e2e = state(this)
    assert.equal(objectValue(inventoryByRuntime(objectValue(this.realRunner)).get('ama')).status, 'ready')
    // Non-ready diagnostics are driven through the heartbeat API directly: the
    // live test-mode bridge only produces ready runtimes.
    const registered = await apiJson<Json>(e2e.page.request, '/api/runners', {
      method: 'POST',
      data: {
        name: `${e2e.runId} diagnostics runner`,
        environmentId: e2e.environment?.id,
        capabilities: ['codex'],
      },
    })
    const firstReport = await heartbeatRunner(e2e, String(registered.id), {
      runtimeInventory: [
        { runtime: 'ama', version: '1.0.0', status: 'ready', detail: 'embedded ama runtime' },
        { runtime: 'codex', status: 'missing', detail: 'codex CLI not found on PATH' },
        {
          runtime: 'claude-code',
          status: 'unauthenticated',
          detail: 'host CLI exposed no models; authenticate the runtime CLI',
        },
        { runtime: 'copilot', status: 'unauthorized', detail: 'host CLI rejected the operator account' },
      ],
    })
    const first = inventoryByRuntime(firstReport)
    assert.equal(objectValue(first.get('ama')).status, 'ready')
    assert.equal(objectValue(first.get('codex')).status, 'missing')
    assert.equal(objectValue(first.get('claude-code')).status, 'unauthenticated')
    assert.equal(objectValue(first.get('copilot')).status, 'unauthorized')

    const secondReport = await heartbeatRunner(e2e, String(registered.id), {
      runtimeInventory: [
        { runtime: 'codex', status: 'limited', detail: 'host CLI usage quota is exhausted' },
        { runtime: 'claude-code', status: 'unhealthy', detail: 'host runtime probe returned no diagnostics' },
      ],
    })
    const second = inventoryByRuntime(secondReport)
    assert.equal(objectValue(second.get('codex')).status, 'limited')
    assert.equal(objectValue(second.get('claude-code')).status, 'unhealthy')

    const invalid = await apiResponse(e2e.page.request, `/api/runners/${registered.id}/heartbeats`, {
      method: 'POST',
      data: {
        status: 'active',
        runtimeInventory: [{ runtime: 'codex', status: 'broken', detail: 'not a known status' }],
      },
    })
    assert.equal(invalid.status(), 400, 'unknown inventory statuses are rejected')
    this.diagnosticsRunner = secondReport
  },
)

Then(
  'AMA stores only safe metadata and never stores provider tokens or local credential values',
  async function (this: InventoryWorld) {
    const e2e = state(this)
    // The live runner authenticated with a raw token and carries raw secret
    // values in its process environment; none of that may reach the stored
    // runner record.
    const realRunner = await apiJson<Json>(e2e.page.request, `/api/runners/${objectValue(this.realRunner).id}`)
    assert.equal(JSON.stringify(realRunner).includes('raw-secret-value'), false)

    const diagnosticsRunner = this.diagnosticsRunner
    assert.ok(diagnosticsRunner, 'diagnostics runner must exist')
    // A token-like diagnostic detail is redacted before storage.
    await heartbeatRunner(e2e, String(diagnosticsRunner.id), {
      runtimeInventory: [{ runtime: 'codex', status: 'unauthenticated', detail: 'token=raw-inventory-secret-marker' }],
    })
    const stored = await apiJson<Json>(e2e.page.request, `/api/runners/${diagnosticsRunner.id}`)
    assert.equal(JSON.stringify(stored).includes('raw-inventory-secret-marker'), false)
    assert.equal(objectValue(inventoryByRuntime(stored).get('codex')).detail, '[REDACTED]')

    // Inventory entries cannot smuggle credential fields at all.
    const rejected = await apiResponse(e2e.page.request, `/api/runners/${diagnosticsRunner.id}/heartbeats`, {
      method: 'POST',
      data: {
        status: 'active',
        runtimeInventory: [
          { runtime: 'codex', status: 'ready', detail: 'ok', apiToken: 'raw-inventory-secret-marker' },
        ],
      },
    })
    assert.equal(rejected.status(), 400, 'credential-shaped inventory fields are rejected')
  },
)

// ─── Lease work only to runners with ready runtime inventory ─────────────────

Given(
  'a self-hosted session requires a runtime, provider, and model',
  { timeout: 120_000 },
  async function (this: InventoryWorld) {
    const e2e = await ensureSignedIn(this)
    e2e.provider = await createProvider(e2e, {
      type: 'openai-compatible',
      displayName: `${e2e.runId} inventory codex provider`,
      baseUrl: 'https://models.example.test/v1',
      credentialSecretRef: `secret://providers/${e2e.runId}/inventory-codex`,
    })
    e2e.providerModel = await createProviderModel(e2e, e2e.provider, {
      modelId: CODEX_E2E_MODEL,
      displayName: 'GPT 5.3 Codex',
      capabilities: ['text'],
    })
    e2e.agent = await createAgent(e2e, {
      name: `${e2e.runId} inventory codex agent`,
      provider: e2e.provider.id,
      model: CODEX_E2E_MODEL,
    })
    e2e.environment = await createEnvironment(e2e, {
      name: `${e2e.runId} inventory codex env`,
      hostingMode: 'self_hosted',
      runtime: 'codex',
      runtimeConfig: { e2eBridgeTest: true, mode: 'deterministic-bridge-test' },
      networkPolicy: { mode: 'unrestricted' },
    })
    this.codexCapabilities = ['codex', runtimeProviderModelCapability('codex', '*', CODEX_E2E_MODEL)]
    this.nonReadyRunner = await registerCodexRunner(e2e, `${e2e.runId} non-ready runner`, this.codexCapabilities)
    e2e.latestSession = await apiJson<Json>(e2e.page.request, '/api/sessions', {
      method: 'POST',
      data: {
        agentId: e2e.agent.id,
        environmentId: e2e.environment.id,
        runtime: 'codex',
        title: `${e2e.runId} inventory session`,
      },
    })
    assert.equal(e2e.latestSession.status, 'pending')
    const workItems = await sessionWorkItems(e2e, String(e2e.latestSession.id))
    assert.equal(
      objectValue(objectValue(workItems.data[0]).payload).requiredRunnerCapability,
      runtimeProviderModelCapability('codex', '*', CODEX_E2E_MODEL),
      'the queued work pins the exact runtime, provider, and model requirement',
    )
  },
)

When('runners heartbeat runtime inventory for the project', async function (this: InventoryWorld) {
  const e2e = state(this)
  const capabilities = this.codexCapabilities
  assert.ok(capabilities, 'codex capabilities must be set')
  this.nonReadyRunner = await heartbeatRunner(e2e, String(objectValue(this.nonReadyRunner).id), {
    runtimeInventory: [
      { runtime: 'ama', status: 'ready', detail: 'embedded ama runtime' },
      { runtime: 'codex', status: 'unauthenticated', detail: 'authenticate the codex CLI' },
    ],
  })
  this.readyRunner = await registerCodexRunner(e2e, `${e2e.runId} ready runner`, capabilities)
  this.readyRunner = await heartbeatRunner(e2e, String(objectValue(this.readyRunner).id), {
    runtimeInventory: [
      { runtime: 'ama', status: 'ready', detail: 'embedded ama runtime' },
      { runtime: 'codex', version: 'bridge-test', status: 'ready', detail: 'deterministic bridge test runtime' },
    ],
  })
})

Then(
  'AMA leases the session only to a runner with the exact ready runtime, provider, and model combination',
  async function (this: InventoryWorld) {
    const e2e = state(this)
    const nonReadyClaim = await claimLeaseResponse(e2e, String(objectValue(this.nonReadyRunner).id))
    assert.equal(nonReadyClaim.status(), 204, 'a runner without a ready codex runtime gets no lease')
    const readyClaim = await claimLeaseResponse(e2e, String(objectValue(this.readyRunner).id))
    assert.equal(readyClaim.status(), 201, 'the ready runner claims the session work')
    e2e.lease = (await readyClaim.json()) as Json
    const workItems = await sessionWorkItems(e2e, String(objectValue(e2e.latestSession).id))
    const item = objectValue(workItems.data[0])
    assert.equal(item.status, 'leased')
    assert.equal(item.runnerId, objectValue(this.readyRunner).id, 'the lease belongs to the ready runner')
  },
)

Then(
  'runners with missing, unauthenticated, unauthorized, limited, or unhealthy runtime status cannot claim that session',
  { timeout: 120_000 },
  async function (this: InventoryWorld) {
    const e2e = state(this)
    this.blockedSession = await apiJson<Json>(e2e.page.request, '/api/sessions', {
      method: 'POST',
      data: {
        agentId: e2e.agent?.id,
        environmentId: e2e.environment?.id,
        runtime: 'codex',
        title: `${e2e.runId} inventory blocked session`,
      },
    })
    const runnerId = String(objectValue(this.nonReadyRunner).id)
    for (const status of NON_READY_STATUSES) {
      await heartbeatRunner(e2e, runnerId, {
        runtimeInventory: [
          { runtime: 'ama', status: 'ready', detail: 'embedded ama runtime' },
          { runtime: 'codex', status, detail: `codex runtime is ${status} on this host` },
        ],
      })
      const claim = await claimLeaseResponse(e2e, runnerId)
      assert.equal(claim.status(), 204, `a ${status} codex runtime cannot claim the session`)
    }
    const workItems = await sessionWorkItems(e2e, String(this.blockedSession.id))
    assert.equal(objectValue(workItems.data[0]).status, 'available', 'the session work stays queued')
  },
)

Then(
  'the session exposes a safe waiting or blocked reason when no ready runner exists',
  async function (this: InventoryWorld) {
    const e2e = state(this)
    // Take the previously-ready runner out of readiness too, so no ready
    // runner exists for the queued session.
    await heartbeatRunner(e2e, String(objectValue(this.readyRunner).id), {
      runtimeInventory: [{ runtime: 'codex', status: 'limited', detail: 'host CLI usage quota is exhausted' }],
    })
    const blocked = await apiJson<Json>(e2e.page.request, `/api/sessions/${objectValue(this.blockedSession).id}`)
    assert.equal(blocked.status, 'pending')
    assert.equal(blocked.statusReason, 'waiting-for-runner', 'the waiting reason is safe and runner-agnostic')
    assert.equal(JSON.stringify(blocked).includes('unauthenticated'), false, 'host diagnostics stay off the session')

    // Readiness is the only gate left: restoring a ready codex runtime lets
    // the same runner claim the same work.
    const runnerId = String(objectValue(this.nonReadyRunner).id)
    await heartbeatRunner(e2e, runnerId, {
      runtimeInventory: [
        { runtime: 'ama', status: 'ready', detail: 'embedded ama runtime' },
        { runtime: 'codex', version: 'bridge-test', status: 'ready', detail: 'deterministic bridge test runtime' },
      ],
    })
    const claim = await claimLeaseResponse(e2e, runnerId)
    assert.equal(claim.status(), 201, 'the recovered runner claims the queued session work')
    const workItems = await sessionWorkItems(e2e, String(objectValue(this.blockedSession).id))
    assert.equal(objectValue(workItems.data[0]).runnerId, runnerId)
  },
)
