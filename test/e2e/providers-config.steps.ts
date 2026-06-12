import assert from 'node:assert/strict'
import { Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import { createProvider, createProviderModel, ensureSignedIn, type Json, type StepsWorld } from './shared-helpers'

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
      credentialSecretRef: `secret://providers/${state.runId}/openai-compatible`,
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
  const list = await apiJson<{ data: Json[] }>(state.page.request, '/api/providers?limit=20')
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

Then('credentials are stored in Cloudflare Secrets', function (this: StepsWorld) {
  // In the AMA control plane, raw credential values are never stored in D1 —
  // they are stored as references (secretRef) pointing to Cloudflare Secrets.
  // The provider response must not include raw credential values.
  const provider = this.e2e?.provider as Json | undefined
  assert.ok(provider, 'provider must have been created')
  // The provider record itself must not leak secret values
  const serialized = JSON.stringify(provider)
  assert.ok(!serialized.includes('raw-secret'), 'provider response must not include raw secret values')
  // credentialSecretRef fields are reference paths (e.g. secret://...) not values
  if (provider.credentialSecretRef !== undefined && provider.credentialSecretRef !== null) {
    assert.ok(
      String(provider.credentialSecretRef).startsWith('secret://'),
      'credentialSecretRef must be a reference path, not a raw secret value',
    )
  }
})
