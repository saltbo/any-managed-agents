import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { Then, When } from '@cucumber/cucumber'
import { apiJson, delay } from './local-app'
import {
  createProvider,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

type DiscoveryWorld = StepsWorld & {
  discoveredProvider?: Json
  discoveryTask?: Json
  discoveryFailureTask?: Json
  unreachableProvider?: Json
}

async function waitForDiscoveryTask(state: E2EState, providerId: string, taskId: string, expected: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const task = await apiJson<Json>(
      state.page.request,
      `/api/v1/providers/${providerId}/model-discovery-tasks/${taskId}`,
    )
    if (task.state === expected) {
      return task
    }
    await delay(500)
  }
  throw new Error(`model discovery task ${taskId} did not reach ${expected}`)
}

// Minimal OpenAI-compatible model-list endpoint so discovery exercises a
// real HTTP fetch from the Worker against a catalog the test controls.
async function startModelCatalogFixture(runId: string) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.setHeader('content-type', 'application/json')
    if (url.pathname !== '/v1/models') {
      response.statusCode = 404
      response.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    response.end(
      JSON.stringify({
        data: [
          {
            id: `${runId}-catalog-model`,
            display_name: 'Discovery Catalog Model',
            capabilities: ['text'],
            context_window: 32000,
            pricing: { inputMicrosPerToken: 3, outputMicrosPerToken: 9 },
          },
        ],
      }),
    )
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('model catalog fixture did not bind a port')
  }
  return { server: server as Server, baseUrl: `http://127.0.0.1:${address.port}/v1` }
}

When('model discovery succeeds', async function (this: DiscoveryWorld) {
  const state = await ensureSignedIn(this)
  const fixture = await startModelCatalogFixture(state.runId)
  try {
    this.discoveredProvider = await createProvider(state, {
      type: 'openai-compatible',
      displayName: `${state.runId} discoverable gateway`,
      baseUrl: fixture.baseUrl,
      credentialRef: { credentialId: `cred-${state.runId}-discoverable` },
    })
    const task = await apiJson<Json>(
      state.page.request,
      `/api/v1/providers/${this.discoveredProvider.id}/model-discovery-tasks`,
      { method: 'POST' },
    )
    this.discoveryTask = await waitForDiscoveryTask(
      state,
      String(this.discoveredProvider.id),
      String(task.id),
      'succeeded',
    )
  } finally {
    fixture.server.close()
  }
})

Then(
  'the model catalog stores id, display name, capabilities, context limits, pricing hints, and availability',
  async function (this: DiscoveryWorld) {
    const state = this.e2e
    assert.ok(state && this.discoveredProvider, 'discovery must have run against a provider')
    const catalog = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/v1/providers/${this.discoveredProvider.id}/models`,
    )
    const model = catalog.data.find((row) => row.modelId === `${state.runId}-catalog-model`)
    assert.ok(model, 'the discovered model is persisted in the provider catalog')
    assert.equal(model.displayName, 'Discovery Catalog Model', 'the catalog stores the display name')
    assert.deepEqual(model.capabilities, ['text'], 'the catalog stores capabilities')
    assert.equal(model.contextWindow, 32000, 'the catalog stores context limits')
    assert.deepEqual(
      model.pricing,
      { inputMicrosPerToken: 3, outputMicrosPerToken: 9 },
      'the catalog stores pricing hints',
    )
    assert.equal(model.availability, 'available', 'the catalog stores availability')
    const provider = await apiJson<Json>(state.page.request, `/api/v1/providers/${this.discoveredProvider.id}`)
    assert.equal(provider.modelCatalogState, 'ready', 'successful discovery marks the catalog ready')
  },
)

When('model discovery fails or the provider is unreachable', async function (this: DiscoveryWorld) {
  const state = await ensureSignedIn(this)
  // The configured provider from the Given points at an unresolvable host.
  assert.ok(state.provider, 'a configured provider must exist')
  this.unreachableProvider = state.provider
  // Discovery is an async task resource: the POST is accepted (201) and the
  // provider failure surfaces in the task state, not the create response.
  const task = await apiJson<Json>(
    state.page.request,
    `/api/v1/providers/${this.unreachableProvider.id}/model-discovery-tasks`,
    { method: 'POST' },
  )
  this.discoveryFailureTask = await waitForDiscoveryTask(
    state,
    String(this.unreachableProvider.id),
    String(task.id),
    'failed',
  )
})

Then('the API returns a safe provider error without leaking credentials', function (this: DiscoveryWorld) {
  assert.ok(this.discoveryFailureTask, 'a failed discovery task must have been captured')
  const error = (this.discoveryFailureTask.error ?? {}) as Json
  assert.equal(error.type, 'provider_error', 'the failure uses the structured provider error envelope')
  assert.ok(
    ['network', 'unknown'].includes(String(error.category)),
    'the failure carries a stable provider error category',
  )
  const serialized = JSON.stringify(this.discoveryFailureTask)
  assert.ok(!serialized.includes('secret://'), 'the failure response never includes credential references')
  assert.ok(!serialized.includes('credentialSecretRef'), 'the failure response never includes credential fields')
})

Then('existing provider configuration remains readable', async function (this: DiscoveryWorld) {
  const state = this.e2e
  assert.ok(state && this.unreachableProvider, 'the unreachable provider must exist')
  const provider = await apiJson<Json>(state.page.request, `/api/v1/providers/${this.unreachableProvider.id}`)
  assert.equal(provider.id, this.unreachableProvider.id, 'the provider is still readable after failed discovery')
  assert.equal(provider.type, 'openai-compatible', 'the stored configuration is unchanged')
  assert.equal(provider.modelCatalogState, 'error', 'the catalog state reflects the failed discovery')
  const lastError = (provider.lastError ?? {}) as Json
  assert.ok(typeof lastError.category === 'string', 'the stored provider health carries the normalized category')
  assert.ok(!JSON.stringify(lastError).includes('secret://'), 'stored provider health never embeds credentials')
})
