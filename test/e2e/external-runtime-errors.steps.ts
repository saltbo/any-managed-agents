import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  bridgeTestRuntimeConfig,
  CLAUDE_CODE_E2E_MODEL,
  type E2EState,
  runtimeProviderModelCapability,
  startProductAmaRunner,
  waitForSessionEvent,
  waitForSessionEventText,
  waitForSessionStatus,
} from './product-api.steps'
import {
  createAgent,
  createEnvironment,
  createProvider,
  createProviderModel,
  delay,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

type RuntimeErrorsWorld = StepsWorld & {
  authFailureMode?: string
}

function state(world: RuntimeErrorsWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e as unknown as E2EState
}

// Provider credentials are unified onto the Vault: mint a vault credential and
// return a `credentialRef` for the provider create body.
async function createProviderCredentialRef(e2e: E2EState, slug: string) {
  e2e.vault ??= await apiJson<Json>(e2e.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${e2e.runId} runtime-errors vault` },
  })
  const credential = await apiJson<Json>(e2e.page.request, `/api/v1/vaults/${(e2e.vault as Json).id}/credentials`, {
    method: 'POST',
    data: {
      name: `${e2e.runId} ${slug} provider key`,
      type: 'api_key',
      metadata: { purpose: 'runtime-errors-e2e' },
      secret: { provider: 'external-vault', externalVaultPath: `vault://ama/e2e/${e2e.runId}/${slug}` },
    },
  })
  return { credentialId: credential.id, versionId: credential.activeVersionId }
}

async function setupOfficialRuntimeSession(
  world: RuntimeErrorsWorld,
  runtimeConfigExtras: Record<string, unknown>,
  initialPrompt: string,
) {
  const e2e = (await ensureSignedIn(world)) as unknown as E2EState
  e2e.environment = await createEnvironment(e2e as never, {
    name: `${e2e.runId} official runtime env`,
    hostingMode: 'self_hosted',
    runtime: 'claude-code',
    runtimeConfig: { ...bridgeTestRuntimeConfig(), ...runtimeConfigExtras },
    networkPolicy: { mode: 'unrestricted' },
  })
  e2e.provider = await createProvider(e2e as never, {
    type: 'anthropic',
    displayName: `${e2e.runId} official runtime provider`,
    credentialRef: await createProviderCredentialRef(e2e, 'official-runtime'),
  })
  e2e.providerModel = await createProviderModel(e2e as never, e2e.provider as Json, {
    modelId: CLAUDE_CODE_E2E_MODEL,
    displayName: 'Claude Sonnet 4.6',
    capabilities: ['text'],
  })
  e2e.agent = await createAgent(e2e as never, {
    name: `${e2e.runId} official runtime agent`,
    providerId: (e2e.provider as Json).id,
    model: CLAUDE_CODE_E2E_MODEL,
  })
  const capability = runtimeProviderModelCapability('claude-code', '*', CLAUDE_CODE_E2E_MODEL)
  e2e.runner = await apiJson<Json>(e2e.page.request, '/api/v1/runners', {
    method: 'POST',
    data: {
      name: `${e2e.runId} official runtime runner`,
      environmentId: (e2e.environment as Json).id,
      capabilities: ['sandbox.exec', capability],
    },
  })
  e2e.latestSession = await apiJson<Json>(e2e.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: (e2e.agent as Json).id,
      environmentId: (e2e.environment as Json).id,
      runtime: 'claude-code',
      title: `${e2e.runId} official runtime session`,
      initialPrompt,
    },
  })
  assert.equal((e2e.latestSession as Json).stateReason, 'waiting-for-runner')
  return e2e
}

async function listSessionEvents(e2e: E2EState) {
  return await apiJson<ListResponse<Json>>(
    e2e.page.request,
    `/api/v1/sessions/${e2e.latestSession?.id}/events?limit=200`,
  )
}

// ─── Surface official runtime authentication and authorization failures ───

Given(
  'a self-hosted environment selects codex, claude-code, or copilot runtime',
  { timeout: 240_000 },
  async function (this: RuntimeErrorsWorld) {
    this.authFailureMode = 'missing_login'
    await setupOfficialRuntimeSession(
      this,
      { e2eBridgeAuthFailure: this.authFailureMode },
      'auth failure initial prompt',
    )
  },
)

Given(
  'the owning runner starts the selected official runtime',
  { timeout: 240_000 },
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    await startProductAmaRunner(e2e)
  },
)

When(
  'the official runtime reports missing login, unauthorized account, disabled product policy, or expired credentials',
  { timeout: 180_000 },
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    await waitForSessionEvent(
      e2e,
      (event) => {
        const record = event as Json
        return record.type === 'runtime.error' && JSON.stringify(record.payload).includes('runtime_auth_')
      },
      'canonical runtime auth error event',
    )
  },
)

Then(
  'ama-runner emits a canonical runtime error event with a stable error code',
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    const events = await listSessionEvents(e2e)
    const authError = events.data.find(
      (event) => event.type === 'runtime.error' && JSON.stringify(event.payload).includes('runtime_auth_'),
    ) as Json
    assert.ok(authError, 'the canonical auth error event is persisted')
    const payload = authError.payload as Record<string, unknown>
    assert.equal(payload.code, 'runtime_auth_missing_login', 'the error carries the stable code')
  },
)

Then(
  'AMA marks the session with a safe status reason that product clients can display',
  { timeout: 120_000 },
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
      if (session.state === 'error' && session.stateReason === 'runtime-auth-missing-login') {
        return
      }
      await delay(1_000)
    }
    const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
    throw new Error(`Expected error/runtime-auth-missing-login, got ${session.state}/${session.stateReason}`)
  },
)

Then(
  'raw credential material, local auth files, and provider tokens are not stored in session events, runner metadata, logs, or OpenAPI responses',
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    const events = await listSessionEvents(e2e)
    const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
    const runner = await apiJson<Json>(e2e.page.request, `/api/v1/runners/${(e2e.runner as Json).id}`)
    for (const surface of [JSON.stringify(events.data), JSON.stringify(session), JSON.stringify(runner)]) {
      assert.ok(!surface.includes('raw-secret'), 'no raw credential material leaks')
      assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(surface), 'no bearer tokens leak')
      assert.ok(!surface.includes('.claude.json'), 'no local auth file paths leak')
      assert.ok(!surface.toLowerCase().includes('api key:'), 'no inline provider keys leak')
    }
  },
)

// ─── Normalize official runtime permission requests ───

Given(
  'an official runtime requests permission for a tool, file, network, or shell action',
  { timeout: 240_000 },
  async function (this: RuntimeErrorsWorld) {
    const e2e = await setupOfficialRuntimeSession(
      this,
      {
        e2eBridgeLive: true,
        e2eBridgePermission: { action: 'shell', command: 'printf permission-ok' },
      },
      'permission flow initial prompt',
    )
    await startProductAmaRunner(e2e)
    await waitForSessionStatus(e2e, 'running')
  },
)

When('ama-runner receives the permission request', { timeout: 180_000 }, async function (this: RuntimeErrorsWorld) {
  const e2e = state(this)
  await waitForSessionEvent(
    e2e,
    (event) => (event as Json).type === 'permission.request',
    'canonical permission request event',
  )
})

Then(
  'ama-runner emits a canonical permission request event with safe action details',
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    const events = await listSessionEvents(e2e)
    const request = events.data.find((event) => event.type === 'permission.request') as Json
    assert.ok(request, 'permission request is part of the canonical stream')
    const payload = request.payload as Record<string, unknown>
    assert.equal(payload.action, 'shell')
    assert.ok(typeof payload.permissionId === 'string' && payload.permissionId, 'a stable permission id is recorded')
    assert.equal(payload.command, 'printf permission-ok', 'safe action details are recorded')
  },
)

Then(
  'AMA applies the session policy before approving or denying the action',
  { timeout: 120_000 },
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    const decision = await waitForSessionEvent(
      e2e,
      (event) => {
        const record = event as Json
        return (
          record.type === 'policy.decision' && JSON.stringify(record.payload).includes('runtime_permission_decision')
        )
      },
      'canonical permission policy decision',
    )
    const payload = (decision as Json).payload as Record<string, unknown>
    assert.equal(payload.allowed, true, 'the unrestricted session policy approves the action')
  },
)

Then(
  'the final approval or denial is recorded as canonical policy and tool events',
  { timeout: 120_000 },
  async function (this: RuntimeErrorsWorld) {
    const e2e = state(this)
    await waitForSessionEventText(e2e, 'permission-approved')
    const events = await listSessionEvents(e2e)
    const serialized = JSON.stringify(events.data)
    assert.ok(serialized.includes('runtime_permission_decision'), 'the policy decision is canonical')
    assert.ok(
      events.data.some(
        (event) => event.type === 'tool_execution_end' && JSON.stringify(event.payload).includes('permission-ok'),
      ),
      'the approved action ran and recorded canonical tool events',
    )
  },
)
