import assert from 'node:assert/strict'
import { Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import {
  createAgent,
  createProvider,
  type E2EState,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

type AuditGovernanceWorld = StepsWorld & {
  changedProvider?: Json
  rawSecretValue?: string
  denyRule?: Json
  deniedSessionError?: Json
}

function rawCredential(state: E2EState) {
  return `raw-${state.runId}-credential-material`
}

// ─── Scenario: Record audit events (usage-audit.feature) ─────────────────────

When(
  'a user changes agents, providers, vaults, governance, or sessions',
  { timeout: 60_000 },
  async function (this: AuditGovernanceWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const provider = await createProvider(state, {
      type: 'openai',
      displayName: `${state.runId} audited provider`,
    })
    this.changedProvider = await apiJson<Json>(state.page.request, `/api/v1/providers/${provider.id}`, {
      method: 'PATCH',
      data: {
        displayName: `${state.runId} audited provider v2`,
        metadata: { apiKey: rawCredential(state), note: `${state.runId} change note` },
      },
    })
  },
)

Then(
  'the platform records actor, action, resource, timestamp, and safe metadata',
  async function (this: AuditGovernanceWorld) {
    const state = this.e2e
    assert.ok(state && this.changedProvider, 'a provider change must have happened')
    const records = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/v1/audit-records?action=provider.update&resourceId=${this.changedProvider.id}`,
    )
    const record = records.data[0]
    assert.ok(record, 'the provider change produced an audit record')
    const user = (state.auth?.user ?? {}) as Json
    assert.equal(record.actorUserId, user.id, 'the record names the acting user')
    assert.equal(record.actorType, 'user', 'the record marks the actor as a user')
    assert.equal(record.action, 'provider.update', 'the record names the action')
    assert.equal(record.resourceType, 'provider', 'the record names the resource type')
    assert.equal(record.resourceId, this.changedProvider.id, 'the record points at the changed resource')
    const createdAt = Date.parse(String(record.createdAt))
    assert.ok(Number.isFinite(createdAt), 'the record carries a parseable timestamp')
    assert.ok(Math.abs(Date.now() - createdAt) < 5 * 60 * 1000, 'the timestamp matches the time of the change')
    const after = (record.after ?? {}) as Json
    const afterMetadata = (after.metadata ?? {}) as Json
    assert.ok(String(JSON.stringify(afterMetadata)).includes(`${state.runId} change note`), 'safe metadata is kept')
    assert.ok(
      !JSON.stringify(record).includes(rawCredential(state)),
      'the recorded metadata never carries the raw credential value',
    )
  },
)

// ─── Scenario: Inspect policy denials (usage-audit.feature) ──────────────────

When('a request is denied by governance policy', { timeout: 120_000 }, async function (this: AuditGovernanceWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Store real credential material first so the audit trail has something
  // secret-shaped that must never leak through denial records or listings.
  this.rawSecretValue = `raw-${state.runId}-secret-token`
  const vault = await apiJson<Json>(state.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${state.runId} governance vault` },
  })
  await apiJson<Json>(state.page.request, `/api/v1/vaults/${vault.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${state.runId} governance credential`,
      type: 'api_key',
      secret: { provider: 'ama-managed', secretValue: this.rawSecretValue },
    },
  })
  this.denyRule = await apiJson<Json>(state.page.request, '/api/v1/access-rules', {
    method: 'POST',
    data: {
      providerId: 'workers-ai',
      effect: 'deny',
      reason: `${state.runId} denied by governance policy`,
    },
  })
  const agent = await createAgent(state, {
    name: `${state.runId} denied agent`,
    model: WORKERS_AI_MODEL,
  })
  const response = await apiResponse(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: agent.id,
      environmentId: state.environment?.id,
      runtime: 'ama',
      title: `${state.runId} denied session`,
    },
  })
  assert.equal(response.status(), 403, 'the session request is denied by governance policy')
  const body = (await response.json()) as Json
  this.deniedSessionError = (body.error ?? {}) as Json
  assert.equal(this.deniedSessionError.type, 'policy_denied', 'the denial uses the structured policy error envelope')
})

Then('the audit log includes the policy rule and resource reference', async function (this: AuditGovernanceWorld) {
  const state = this.e2e
  assert.ok(state && this.denyRule, 'a governance denial must have happened')
  const records = await apiJson<ListResponse<Json>>(state.page.request, '/api/v1/audit-records?outcome=denied')
  const record = records.data.find((candidate) => {
    const metadata = (candidate.metadata ?? {}) as Json
    const decision = (metadata.decision ?? {}) as Json
    return decision.rule === this.denyRule?.id
  })
  assert.ok(record, 'the denial audit record cites the governance rule that denied it')
  assert.ok(record.policyCategory, 'the denial audit record names the policy category')
  const metadata = (record.metadata ?? {}) as Json
  assert.equal(metadata.providerId, 'workers-ai', 'the denial audit record references the denied provider')
  assert.equal(metadata.modelId, WORKERS_AI_MODEL, 'the denial audit record references the denied model')
  assert.equal(record.outcome, 'denied', 'the denial audit record outcome is denied')
  this.deniedSessionError = { ...this.deniedSessionError, auditRecord: record }
})

Then('does not include secret values', async function (this: AuditGovernanceWorld) {
  const state = this.e2e
  assert.ok(state && this.rawSecretValue, 'secret material must have been stored before the denial')
  const records = await apiJson<ListResponse<Json>>(state.page.request, '/api/v1/audit-records?limit=100')
  const serialized = JSON.stringify(records)
  const credentialRecord = records.data.find((candidate) => candidate.action === 'vault_credential.create')
  assert.ok(credentialRecord, 'the credential write itself is audited')
  assert.ok(!serialized.includes(this.rawSecretValue), 'the audit log never carries the raw secret value')
})
