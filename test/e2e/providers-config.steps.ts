import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  createAgent,
  createEnvironment,
  createProvider,
  createProviderModel,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

// ─── Scenario: Configure model providers ─────────────────────────────────────

When(
  'an operator adds Workers AI, Anthropic, OpenAI, OpenAI-compatible, Ollama, or another supported provider',
  async function (this: StepsWorld) {
    const state = await ensureSignedIn(this)
    // Create a representative set of provider types to exercise the full creation path
    state.provider = await createProvider(state, {
      type: 'workers-ai',
      displayName: `${state.runId} Workers AI`,
    })
    await createProviderModel(state, state.provider, {
      modelId: '@cf/moonshotai/kimi-k2.6',
      displayName: 'Kimi K2',
      capabilities: ['text'],
    })
    // Also create an openai-compatible provider to verify multi-provider support
    const openaiCompatible = await createProvider(state, {
      type: 'openai-compatible',
      displayName: `${state.runId} OpenAI-Compatible`,
      baseUrl: 'https://models.example.test/v1',
    })
    await createProviderModel(state, openaiCompatible, {
      modelId: 'gpt-5.3-codex',
      displayName: 'GPT 5.3 Codex',
      capabilities: ['text'],
    })
  },
)

Then('the platform stores provider metadata in D1', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Verify the created providers are listed via the API (backed by D1)
  const list = await apiJson<{ data: Json[] }>(state.page.request, '/api/v1/providers?limit=20')
  assert.ok(Array.isArray(list.data), 'providers list must be an array')
  const runIdProviders = list.data.filter((p) => String(p.displayName).includes(state.runId))
  assert.ok(
    runIdProviders.length >= 1,
    `Expected at least one provider with runId in displayName; found ${runIdProviders.length}`,
  )
  // Verify the stored provider has the expected metadata fields
  const providerRecord = runIdProviders[0] as Json
  assert.ok(typeof providerRecord.id === 'string', 'provider must have an id')
  assert.ok(typeof providerRecord.type === 'string', 'provider must have a type')
  assert.ok(typeof providerRecord.displayName === 'string', 'provider must have a displayName')
})

// ─── Scenario: Dispatch configured provider connection details to the session runtime ───

type DispatchWorld = StepsWorld & {
  dispatchModel?: string
  dispatchCredentialId?: string
  dispatchCredentialVersionId?: string
  dispatchWorkItemId?: string
  dispatchWorkPayload?: Json
}

const DISPATCH_BASE_URL = 'https://models.example.test/v1'
const DISPATCH_SECRET_VALUE = 'raw-dispatch-provider-key'

Given('a configured provider with a base URL and a vault credential reference', async function (this: DispatchWorld) {
  const state = await ensureSignedIn(this)
  const vault = await apiJson<Json>(state.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${state.runId} provider vault` },
  })
  const credential = await apiJson<Json>(state.page.request, `/api/v1/vaults/${vault.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${state.runId} provider key`,
      type: 'api_key',
      secret: { provider: 'cloudflare-secrets', secretValue: DISPATCH_SECRET_VALUE },
    },
  })
  this.dispatchCredentialId = String(credential.id)
  this.dispatchCredentialVersionId = String(credential.activeVersionId)
  state.provider = await createProvider(state, {
    type: 'openai-compatible',
    displayName: `${state.runId} dispatchable gateway`,
    baseUrl: DISPATCH_BASE_URL,
    credentialRef: { credentialId: this.dispatchCredentialId },
  })
})

Given('an agent selects that configured provider and one of its models', async function (this: DispatchWorld) {
  const state = this.e2e
  assert.ok(state?.provider, 'a configured provider must exist')
  this.dispatchModel = 'gpt-5.3-codex'
  await createProviderModel(state, state.provider, {
    modelId: this.dispatchModel,
    displayName: 'GPT 5.3 Codex',
    capabilities: ['text'],
  })
  state.agent = await createAgent(state, {
    name: `${state.runId} dispatch agent`,
    providerId: state.provider.id,
    model: this.dispatchModel,
  })
})

When('the user creates a self-hosted session for that agent', async function (this: DispatchWorld) {
  const state = this.e2e
  assert.ok(state?.agent, 'an agent must exist')
  state.environment = await createEnvironment(state, {
    name: `${state.runId} dispatch env`,
    hostingMode: 'self_hosted',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.latestSession = await apiJson<Json>(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      runtime: 'codex',
      title: `${state.runId} dispatch session`,
    },
  })
})

Then(
  'the queued runner work carries the provider base URL in the runtime environment',
  async function (this: DispatchWorld) {
    const state = this.e2e
    assert.ok(state?.latestSession, 'a session must exist')
    const workItems = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/v1/work-items?sessionId=${state.latestSession.id}`,
    )
    const workItem = workItems.data.find((item) => item.type === 'session.start')
    assert.ok(workItem, 'queued session.start work must exist')
    this.dispatchWorkItemId = String(workItem.id)
    this.dispatchWorkPayload = workItem.payload as Json
    const runtimeEnv = this.dispatchWorkPayload.runtimeEnv as Json
    assert.equal(runtimeEnv.OPENAI_BASE_URL, DISPATCH_BASE_URL, 'the provider base URL reaches the runtime env')
  },
)

Then(
  'the queued runner work carries the provider credential only as a vault reference',
  function (this: DispatchWorld) {
    assert.ok(this.dispatchWorkPayload, 'the queued work payload must have been inspected')
    // The operator-facing work item view redacts secret env entries entirely;
    // the raw credential value must never appear in the queued payload.
    const serialized = JSON.stringify(this.dispatchWorkPayload)
    assert.ok(!serialized.includes(DISPATCH_SECRET_VALUE), 'the queued work payload never contains the raw credential')
    const runtimeEnv = this.dispatchWorkPayload.runtimeEnv as Json
    assert.equal(runtimeEnv.OPENAI_API_KEY, undefined, 'the queued runtime env carries no credential value')
  },
)

Then(
  'the provider credential value is materialized only when a runner leases the work',
  async function (this: DispatchWorld) {
    const state = this.e2e
    assert.ok(state?.environment && this.dispatchModel, 'the dispatch session context must exist')
    assert.ok(this.dispatchWorkItemId, 'the queued work item must have been discovered')
    const capability = `runtime-provider-model:codex:*:${this.dispatchModel}`
    const runner = await apiJson<Json>(state.page.request, '/api/v1/runners', {
      method: 'POST',
      data: { name: `${state.runId} dispatch runner`, environmentId: state.environment.id, capabilities: [capability] },
    })
    await apiJson<Json>(state.page.request, `/api/v1/runners/${runner.id}/heartbeat`, {
      method: 'PUT',
      data: { state: 'active', capabilities: [capability] },
    })
    // Create the lease for the discovered work item, then read the materialized
    // payload back from GET /work-items/{id}: lease creation returns the lease
    // only, and secret env is resolved into runtimeEnv for the owning runner.
    await apiJson<Json>(state.page.request, '/api/v1/leases', {
      method: 'POST',
      data: { workItemId: this.dispatchWorkItemId, runnerId: runner.id },
    })
    const workItem = await apiJson<Json>(state.page.request, `/api/v1/work-items/${this.dispatchWorkItemId}`)
    const payload = workItem.payload as Json
    const runtimeEnv = payload.runtimeEnv as Json
    assert.equal(
      runtimeEnv.OPENAI_API_KEY,
      DISPATCH_SECRET_VALUE,
      'the leased work env carries the resolved credential',
    )
    assert.equal(runtimeEnv.OPENAI_BASE_URL, DISPATCH_BASE_URL, 'the leased work env keeps the provider base URL')
    const secretEnv = payload.runtimeSecretEnv as Array<{ name: string; credentialRef: Json }>
    assert.deepEqual(
      secretEnv.filter((item) => item.name === 'OPENAI_API_KEY'),
      [
        {
          name: 'OPENAI_API_KEY',
          credentialRef: { credentialId: this.dispatchCredentialId, versionId: this.dispatchCredentialVersionId },
        },
      ],
      'the runner-facing payload carries the provider credential as a vault credential reference',
    )
  },
)

Then('credentials are stored in Cloudflare Secrets', function (this: StepsWorld) {
  // In the AMA control plane, raw credential values are never stored in D1 —
  // they are exposed only as vault credential references. The provider response
  // must not include raw credential values.
  const provider = this.e2e?.provider as Json | undefined
  assert.ok(provider, 'provider must have been created')
  // The provider record itself must not leak secret values
  const serialized = JSON.stringify(provider)
  assert.ok(!serialized.includes('raw-secret'), 'provider response must not include raw secret values')
  // credentialRef is a vault reference object ({ credentialId, versionId? }), never a raw value.
  if (provider.credentialRef !== undefined && provider.credentialRef !== null) {
    const credentialRef = provider.credentialRef as Json
    assert.ok(
      typeof credentialRef.credentialId === 'string' && credentialRef.credentialId.length > 0,
      'credentialRef must be a vault credential reference, not a raw secret value',
    )
  }
})
