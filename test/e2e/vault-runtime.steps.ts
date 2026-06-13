import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import type { Page } from '@playwright/test'
import { apiJson, apiResponse, authenticateE2EPage, openLocalPage, waitForSession } from './local-app'
import type { AmaWorld } from './world'

type Json = Record<string, unknown>

interface ListResponse<T> {
  data: T[]
  pagination: Json
}

const AMA_RUNNER_CAPABILITY = 'runtime-provider-model:ama:workers-ai:@cf/moonshotai/kimi-k2.6'

// Shares the `e2e` world slot with product-api.steps.ts so vault-secrets
// scenarios can build on the existing "a project has a vault" background.
interface SharedE2EState {
  page: Page
  runId: string
  vault?: Json
  credential?: Json
  agent?: Json
  environment?: Json
  latestSession?: Json
  runner?: Json
}

interface VaultFlowState {
  rawValue?: string
  rotatedValue?: string
  firstVersionId?: string
  secondVersionId?: string
  secondStoredVersionId?: string
  historicalSession?: Json
  rotatedCredential?: Json
  outsiderResponses?: Array<{ status: number; body: string }>
  lease?: Json
  leaseWorkItemId?: string
  leaseDenialStatus?: number
  leaseDenialBody?: string
  pendingSession?: Json
  encryptionPlaintext?: string
}

type VaultWorld = AmaWorld & { e2e?: SharedE2EState; vaultFlow?: VaultFlowState }

function flow(world: VaultWorld): VaultFlowState {
  world.vaultFlow ??= {}
  return world.vaultFlow
}

async function ensureSignedIn(world: VaultWorld): Promise<SharedE2EState> {
  if (world.e2e) {
    return world.e2e
  }
  const page = await openLocalPage()
  await authenticateE2EPage(page)
  world.e2e = { page, runId: `vault-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}` }
  return world.e2e
}

async function ensureVault(world: VaultWorld): Promise<SharedE2EState> {
  const state = await ensureSignedIn(world)
  state.vault ??= await apiJson<Json>(state.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${state.runId} vault`, description: 'Vault runtime e2e vault', scope: 'project' },
  })
  return state
}

// Raw values intentionally avoid the words "secret" and "token": those match
// the platform redaction patterns, and a redacted leak would make the
// never-exposed assertions in these steps pass vacuously.
function newRawValue(state: SharedE2EState, label: string) {
  return `vault-material-${label}-${state.runId}`
}

async function createManagedCredential(state: SharedE2EState, name: string, rawValue: string) {
  return await apiJson<Json>(state.page.request, `/api/v1/vaults/${state.vault?.id}/credentials`, {
    method: 'POST',
    data: {
      name,
      type: 'api_key',
      connectorBinding: { connectorId: 'workers-ai', name: 'apiKey' },
      metadata: { purpose: 'vault-runtime-e2e' },
      secret: { provider: 'ama-managed', secretValue: rawValue },
    },
  })
}

function activeVersionId(credential: Json | undefined) {
  const id = credential?.activeVersionId
  assert.equal(typeof id, 'string', 'credential must expose an active version id')
  return String(id)
}

async function ensureCloudAgentAndEnvironment(state: SharedE2EState) {
  state.agent ??= await apiJson<Json>(state.page.request, '/api/v1/agents', {
    method: 'POST',
    data: { name: `${state.runId} agent`, instructions: 'Vault runtime e2e agent' },
  })
  state.environment ??= await apiJson<Json>(state.page.request, '/api/v1/environments', {
    method: 'POST',
    data: { name: `${state.runId} env`, runtimeConfig: { image: 'ama-pi-runtime' } },
  })
}

async function createSessionWithSecretRef(
  state: SharedE2EState,
  options: { envName: string; ref: string; title: string },
) {
  await ensureCloudAgentAndEnvironment(state)
  const session = await apiJson<Json>(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      runtime: 'ama',
      title: options.title,
      secretEnv: [
        { name: options.envName, credentialRef: { credentialId: state.credential?.id, versionId: options.ref } },
      ],
    },
  })
  return session
}

async function setupSelfHostedRunnerSession(state: SharedE2EState, world: VaultWorld, envName: string) {
  state.agent = await apiJson<Json>(state.page.request, '/api/v1/agents', {
    method: 'POST',
    data: { name: `${state.runId} runner agent`, instructions: 'Vault runtime e2e runner agent' },
  })
  state.environment = await apiJson<Json>(state.page.request, '/api/v1/environments', {
    method: 'POST',
    data: {
      name: `${state.runId} runner env`,
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
      runtimeConfig: { image: 'ama-pi-runtime' },
    },
  })
  state.runner = await apiJson<Json>(state.page.request, '/api/v1/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} runner`,
      environmentId: state.environment.id,
      capabilities: ['node', 'git', 'sandbox.exec', AMA_RUNNER_CAPABILITY],
    },
  })
  // Heartbeat is the idempotent PUT singleton; it returns a heartbeat
  // representation (no `id`), so keep the runner row captured above.
  await apiJson<Json>(state.page.request, `/api/v1/runners/${state.runner.id}/heartbeat`, {
    method: 'PUT',
    data: { state: 'active', currentLoad: 0, capabilities: ['node', 'git', 'sandbox.exec', AMA_RUNNER_CAPABILITY] },
  })
  const session = await apiJson<Json>(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      runtime: 'ama',
      title: `${state.runId} runner session`,
      secretEnv: [
        {
          name: envName,
          credentialRef: { credentialId: state.credential?.id, versionId: activeVersionId(state.credential) },
        },
      ],
    },
  })
  flow(world).pendingSession = session
  state.latestSession = session
  return session
}

async function versionStorage(state: SharedE2EState, versionId: string) {
  return await apiJson<{ encryptionKeyConfigured: boolean; row: Json }>(
    state.page.request,
    `/api/v1/e2e/vault-credential-versions/${versionId}/storage`,
  )
}

async function auditRecords(state: SharedE2EState, query: string) {
  return await apiJson<ListResponse<Json>>(state.page.request, `/api/v1/audit-records?${query}`)
}

// ─── vault-secrets.feature: Store provider credentials ───

When('the user stores an API key or provider token', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const rawValue = newRawValue(state, 'store')
  flow(this).rawValue = rawValue
  state.credential = await apiJson<Json>(state.page.request, `/api/v1/vaults/${state.vault?.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${state.runId} provider key`,
      type: 'api_key',
      connectorBinding: { connectorId: 'workers-ai', name: 'apiKey' },
      secret: { provider: 'cloudflare-secrets', secretValue: rawValue },
    },
  })
})

Then('the secret value is stored in Cloudflare Secrets', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const version = state.credential?.activeVersion as Json
  assert.equal(version.provider, 'cloudflare-secrets')
  assert.equal(String(version.secretRef).startsWith('cloudflare-secret:'), true)
  assert.equal(version.hasSecret, true)
  const storage = await versionStorage(state, String(version.id))
  const storedMetadata = JSON.parse(String(storage.row.metadata)) as Json
  assert.equal(typeof storedMetadata.cloudflareSecretId, 'string', 'a Cloudflare secret store id must be recorded')
})

Then('D1 stores only secret metadata and references', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const rawValue = String(flow(this).rawValue)
  const version = state.credential?.activeVersion as Json
  const storage = await versionStorage(state, String(version.id))
  const persisted = JSON.stringify(storage.row)
  assert.equal(persisted.includes(rawValue), false, 'raw value must not be persisted to D1')
  const storedMetadata = JSON.parse(String(storage.row.metadata)) as { encryptedSecretValue?: Json }
  assert.equal(storedMetadata.encryptedSecretValue?.algorithm, 'AES-GCM')
  assert.equal(String(storage.row.secretRef).startsWith('cloudflare-secret:'), true)
})

Then('API responses never include the raw secret value', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const rawValue = String(flow(this).rawValue)
  assert.equal(JSON.stringify(state.credential).includes(rawValue), false)
  const read = await apiJson<Json>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}`,
  )
  assert.equal(JSON.stringify(read).includes(rawValue), false)
  const versions = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions`,
  )
  assert.equal(JSON.stringify(versions).includes(rawValue), false)
})

// ─── vault-secrets.feature: Rotate a credential ───

When('the user rotates a credential', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.rawValue = newRawValue(state, 'v1')
  scenario.rotatedValue = newRawValue(state, 'v2')
  state.credential = await createManagedCredential(state, `${state.runId} rotating credential`, scenario.rawValue)
  scenario.firstVersionId = activeVersionId(state.credential)
  state.credential = await apiJson<Json>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions`,
    { method: 'POST', data: { provider: 'ama-managed', secretValue: scenario.rotatedValue } },
  )
  scenario.secondVersionId = activeVersionId(state.credential)
  assert.notEqual(scenario.secondVersionId, scenario.firstVersionId)
})

Then('new sessions use the new credential version', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const created = await createSessionWithSecretRef(state, {
    envName: 'ROTATED_PROVIDER_KEY',
    ref: String(scenario.secondVersionId),
    title: `${state.runId} post-rotation session`,
  })
  const session = await waitForSession(state.page.request, String(created.id))
  const refs = (session as unknown as Json).secretEnv as Array<Json> | undefined
  const sessionJson = JSON.stringify(session)
  assert.deepEqual(refs, [
    {
      name: 'ROTATED_PROVIDER_KEY',
      credentialRef: { credentialId: state.credential?.id, versionId: scenario.secondVersionId },
    },
  ])
  assert.equal(sessionJson.includes(String(scenario.rawValue)), false)
  assert.equal(sessionJson.includes(String(scenario.rotatedValue)), false)
})

Then('existing audit records keep the previous credential reference', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const records = await auditRecords(state, 'resourceType=vault_credential&action=vault_credential.rotate')
  const rotateRecord = records.data.find((record) => record.resourceId === state.credential?.id)
  assert.ok(rotateRecord, 'rotation must record an audit event')
  const before = rotateRecord.before as Json
  const after = rotateRecord.after as Json
  assert.equal(before.activeVersionId, scenario.firstVersionId)
  assert.equal(after.activeVersionId, scenario.secondVersionId)
  const serialized = JSON.stringify(records)
  assert.equal(serialized.includes(String(scenario.rawValue)), false)
  assert.equal(serialized.includes(String(scenario.rotatedValue)), false)
})

// ─── vault-secrets.feature: Deny unauthorized vault access ───

When('a user outside the project requests a vault or credential', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.rawValue = newRawValue(state, 'deny')
  state.credential ??= await createManagedCredential(state, `${state.runId} guarded credential`, scenario.rawValue)
  const outsiderPage = await openLocalPage()
  await authenticateE2EPage(outsiderPage)
  const responses = []
  for (const path of [
    `/api/v1/vaults/${state.vault?.id}`,
    `/api/v1/vaults/${state.vault?.id}/credentials`,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}`,
  ]) {
    const response = await apiResponse(outsiderPage.request, path)
    responses.push({ status: response.status(), body: await response.text() })
  }
  scenario.outsiderResponses = responses
  await outsiderPage.context().close()
})

Then('the request is rejected', function (this: VaultWorld) {
  const responses = flow(this).outsiderResponses ?? []
  assert.equal(responses.length > 0, true)
  for (const response of responses) {
    assert.equal(response.status, 404)
  }
})

Then('no secret metadata is disclosed', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const responses = flow(this).outsiderResponses ?? []
  for (const response of responses) {
    assert.equal(response.body.includes(String(state.vault?.name)), false)
    assert.equal(response.body.includes(String(state.credential?.name)), false)
    assert.equal(response.body.includes('cloudflare-secret:'), false)
    assert.equal(response.body.includes('ama-managed:'), false)
    assert.equal(response.body.includes(String(flow(this).rawValue)), false)
  }
})

// ─── vaults.feature: Resolve credential for runtime ───

Given('a session is allowed to use a vault credential', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.rawValue = newRawValue(state, 'runtime')
  state.credential = await createManagedCredential(state, `${state.runId} runtime credential`, scenario.rawValue)
  await setupSelfHostedRunnerSession(state, this, 'RUNTIME_PROVIDER_KEY')
})

When('runtime needs the credential', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const sessionId = String((scenario.pendingSession as Json).id)
  // Two-step claim: discover the session's available work item, then lease it.
  const available = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/work-items?state=available&sessionId=${sessionId}`,
  )
  const workItem = available.data[0]
  assert.ok(workItem, 'the session must have an available work item to lease')
  scenario.leaseWorkItemId = String(workItem.id)
  scenario.lease = await apiJson<Json>(state.page.request, '/api/v1/leases', {
    method: 'POST',
    data: { workItemId: workItem.id, runnerId: state.runner?.id, leaseDurationSeconds: 90 },
  })
})

Then('it resolves a safe secret reference without exposing the value to clients', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const rawValue = String(scenario.rawValue)
  // Lease creation returns the lease only; the materialized payload (secret env
  // resolved into runtimeEnv) is read back from GET /work-items/{id}.
  const workItem = await apiJson<Json>(state.page.request, `/api/v1/work-items/${scenario.leaseWorkItemId}`)
  const payload = workItem.payload as { runtimeEnv?: Record<string, string> }
  assert.equal(
    payload.runtimeEnv?.RUNTIME_PROVIDER_KEY,
    rawValue,
    'lease materialization must resolve the credential reference into the runtime secret env',
  )

  const sessionId = String((scenario.pendingSession as Json).id)
  const session = await apiJson<Json>(state.page.request, `/api/v1/sessions/${sessionId}`)
  assert.deepEqual(session.secretEnv, [
    {
      name: 'RUNTIME_PROVIDER_KEY',
      credentialRef: { credentialId: state.credential?.id, versionId: activeVersionId(state.credential) },
    },
  ])
  assert.equal(JSON.stringify(session).includes(rawValue), false, 'session API must expose references only')

  const workItems = await apiJson<ListResponse<Json>>(state.page.request, `/api/v1/work-items?sessionId=${sessionId}`)
  assert.equal(JSON.stringify(workItems).includes(rawValue), false, 'persisted work items must store references only')

  const events = await apiJson<ListResponse<Json>>(state.page.request, `/api/v1/sessions/${sessionId}/events`)
  assert.equal(JSON.stringify(events).includes(rawValue), false, 'session events must never carry the raw value')
})

// ─── vaults.feature: Store credentials encrypted at rest ───

Given('the platform encryption key is configured', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const probe = await createManagedCredential(state, `${state.runId} encryption probe`, newRawValue(state, 'probe'))
  const storage = await versionStorage(state, activeVersionId(probe))
  assert.equal(storage.encryptionKeyConfigured, true, 'AMA_VAULT_ENCRYPTION_KEY must be configured')
})

When('a user stores a credential in a vault', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.encryptionPlaintext = newRawValue(state, 'plain')
  const first = await createManagedCredential(state, `${state.runId} encrypted A`, scenario.encryptionPlaintext)
  const second = await createManagedCredential(state, `${state.runId} encrypted B`, scenario.encryptionPlaintext)
  state.credential = first
  scenario.firstVersionId = activeVersionId(first)
  scenario.secondStoredVersionId = activeVersionId(second)
})

Then('the persisted value is encrypted with authenticated encryption', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const storage = await versionStorage(state, String(scenario.firstVersionId))
  const metadata = JSON.parse(String(storage.row.metadata)) as { encryptedSecretValue?: Json }
  assert.equal(metadata.encryptedSecretValue?.algorithm, 'AES-GCM')
  assert.equal(typeof metadata.encryptedSecretValue?.iv, 'string')
  assert.equal(typeof metadata.encryptedSecretValue?.ciphertext, 'string')
  const check = await apiJson<Json>(
    state.page.request,
    `/api/v1/e2e/vault-credential-versions/${scenario.firstVersionId}/encryption-check`,
    { method: 'POST', data: { expectedValue: scenario.encryptionPlaintext } },
  )
  assert.equal(check.decrypts, true)
  assert.equal(check.matchesExpected, true, 'ciphertext must round-trip back to the stored plaintext')
})

Then('repeated encryption of the same value produces different ciphertext', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const first = await versionStorage(state, String(scenario.firstVersionId))
  const second = await versionStorage(state, String(scenario.secondStoredVersionId))
  const firstEncrypted = (JSON.parse(String(first.row.metadata)) as { encryptedSecretValue: Json }).encryptedSecretValue
  const secondEncrypted = (JSON.parse(String(second.row.metadata)) as { encryptedSecretValue: Json })
    .encryptedSecretValue
  assert.notEqual(firstEncrypted.ciphertext, secondEncrypted.ciphertext)
  assert.notEqual(firstEncrypted.iv, secondEncrypted.iv)
})

Then('tampered ciphertext cannot be decrypted successfully', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const check = await apiJson<Json>(
    state.page.request,
    `/api/v1/e2e/vault-credential-versions/${scenario.firstVersionId}/encryption-check`,
    { method: 'POST', data: {} },
  )
  assert.equal(check.tamperRejected, true, 'tampered ciphertext must fail authenticated decryption')
})

Then('plaintext is never written to D1, logs, events, or audit metadata', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const plaintext = String(scenario.encryptionPlaintext)
  for (const versionId of [scenario.firstVersionId, scenario.secondStoredVersionId]) {
    const storage = await versionStorage(state, String(versionId))
    assert.equal(JSON.stringify(storage.row).includes(plaintext), false, 'D1 rows must not contain plaintext')
  }
  const records = await auditRecords(state, 'resourceType=vault_credential')
  assert.equal(JSON.stringify(records).includes(plaintext), false, 'audit metadata must not contain plaintext')
  const credentials = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials`,
  )
  assert.equal(JSON.stringify(credentials).includes(plaintext), false, 'API responses must not contain plaintext')
})

// ─── vaults.feature: Scope vault credentials to organization and project ───

interface ScopeState {
  otherOrgPage?: Page
  sameOrgProjectId?: string
  orgScopedVault?: Json
}

type ScopeWorld = VaultWorld & { vaultScope?: ScopeState }

Given('two projects exist in different organizations', async function (this: ScopeWorld) {
  await ensureSignedIn(this)
  const otherOrgPage = await openLocalPage()
  await authenticateE2EPage(otherOrgPage)
  this.vaultScope = { otherOrgPage }
})

When('one project stores a credential', async function (this: ScopeWorld) {
  const state = await ensureVault(this)
  flow(this).rawValue = newRawValue(state, 'scope')
  state.credential = await createManagedCredential(
    state,
    `${state.runId} scoped credential`,
    String(flow(this).rawValue),
  )
})

Then(
  'users in the other organization cannot list, resolve, rotate, or use that credential',
  async function (this: ScopeWorld) {
    const state = await ensureVault(this)
    const otherOrgPage = this.vaultScope?.otherOrgPage
    assert.ok(otherOrgPage, 'other organization page must exist')

    const list = await apiResponse(otherOrgPage.request, `/api/v1/vaults/${state.vault?.id}/credentials`)
    assert.equal(list.status(), 404)
    const read = await apiResponse(
      otherOrgPage.request,
      `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}`,
    )
    assert.equal(read.status(), 404)
    const rotate = await apiResponse(
      otherOrgPage.request,
      `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions`,
      { method: 'POST', data: { provider: 'ama-managed', secretValue: newRawValue(state, 'cross-org') } },
    )
    assert.equal(rotate.status(), 404)

    // "Use" means runtime binding: a session in the other organization cannot
    // reference the credential version, so admission rejects it outright.
    const agent = await apiJson<Json>(otherOrgPage.request, '/api/v1/agents', {
      method: 'POST',
      data: { name: `${state.runId} other org agent`, instructions: 'Cross-org scope check' },
    })
    const environment = await apiJson<Json>(otherOrgPage.request, '/api/v1/environments', {
      method: 'POST',
      data: { name: `${state.runId} other org env`, runtimeConfig: { image: 'ama-pi-runtime' } },
    })
    const sessionAttempt = await apiResponse(otherOrgPage.request, '/api/v1/sessions', {
      method: 'POST',
      data: {
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        title: `${state.runId} cross-org session`,
        secretEnv: [
          {
            name: 'FORBIDDEN_KEY',
            credentialRef: { credentialId: state.credential?.id, versionId: activeVersionId(state.credential) },
          },
        ],
      },
    })
    assert.equal(sessionAttempt.status(), 400, 'foreign credential references must be rejected at admission')
    const body = await sessionAttempt.text()
    assert.match(body, /must exist, be active/)
    assert.equal(body.includes(String(flow(this).rawValue)), false)
    assert.equal(body.includes(String(state.credential?.name)), false)
  },
)

Then('cross-project access in the same organization requires explicit policy', async function (this: ScopeWorld) {
  const state = await ensureVault(this)
  const sibling = await apiJson<Json>(state.page.request, '/api/v1/projects', {
    method: 'POST',
    data: { name: `${state.runId} sibling project` },
  })
  const siblingHeaders = { 'x-ama-project-id': String(sibling.id) }

  // Project-scoped vaults stay invisible to sibling projects in the same org.
  const projectScopedRead = await apiResponse(state.page.request, `/api/v1/vaults/${state.vault?.id}`, {
    headers: siblingHeaders,
  })
  assert.equal(projectScopedRead.status(), 404)

  // Sharing requires the explicit organization scope policy on the vault.
  const orgVault = await apiJson<Json>(state.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${state.runId} org vault`, scope: 'organization' },
  })
  const orgScopedRead = await apiJson<Json>(state.page.request, `/api/v1/vaults/${orgVault.id}`, {
    headers: siblingHeaders,
  })
  assert.equal(orgScopedRead.scope, 'organization')
  assert.equal(orgScopedRead.id, orgVault.id)
})

// ─── vaults.feature: Rotate a credential without breaking historical auditability ───

Given('a credential has version 1', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.rawValue = newRawValue(state, 'history-v1')
  state.credential = await createManagedCredential(state, `${state.runId} historical credential`, scenario.rawValue)
  scenario.firstVersionId = activeVersionId(state.credential)
  const created = await createSessionWithSecretRef(state, {
    envName: 'HISTORICAL_PROVIDER_KEY',
    ref: scenario.firstVersionId,
    title: `${state.runId} historical session`,
  })
  scenario.historicalSession = (await waitForSession(state.page.request, String(created.id))) as unknown as Json
})

When('a user rotates the credential', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.rotatedValue = newRawValue(state, 'history-v2')
  scenario.rotatedCredential = await apiJson<Json>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions`,
    { method: 'POST', data: { provider: 'ama-managed', secretValue: scenario.rotatedValue } },
  )
  state.credential = scenario.rotatedCredential
  scenario.secondVersionId = activeVersionId(state.credential)
})

Then('version 2 becomes the active version for future sessions', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const activeVersion = (scenario.rotatedCredential as Json).activeVersion as Json
  assert.equal(activeVersion.version, 2)
  const created = await createSessionWithSecretRef(state, {
    envName: 'HISTORICAL_PROVIDER_KEY',
    ref: String(scenario.secondVersionId),
    title: `${state.runId} future session`,
  })
  const session = await waitForSession(state.page.request, String(created.id))
  assert.deepEqual((session as unknown as Json).secretEnv, [
    {
      name: 'HISTORICAL_PROVIDER_KEY',
      credentialRef: { credentialId: state.credential?.id, versionId: scenario.secondVersionId },
    },
  ])
})

Then('historical sessions keep safe references to the version they used', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const historicalId = (scenario.historicalSession as Json).id
  const historical = await apiJson<Json>(state.page.request, `/api/v1/sessions/${historicalId}`)
  assert.deepEqual(historical.secretEnv, [
    {
      name: 'HISTORICAL_PROVIDER_KEY',
      credentialRef: { credentialId: state.credential?.id, versionId: scenario.firstVersionId },
    },
  ])
  assert.equal(JSON.stringify(historical).includes(String(scenario.rawValue)), false)
})

Then('the old value is no longer returned or exposed', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  const versions = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions`,
  )
  const firstVersion = versions.data.find((version) => version.id === scenario.firstVersionId)
  assert.equal(firstVersion?.state, 'superseded')
  const serialized = JSON.stringify(versions)
  assert.equal(serialized.includes(String(scenario.rawValue)), false)
  assert.equal(serialized.includes(String(scenario.rotatedValue)), false)
})

// ─── vaults.feature: Revoke a credential ───

Given('a credential is active', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.rawValue = newRawValue(state, 'revoke')
  state.credential = await createManagedCredential(state, `${state.runId} revocable credential`, scenario.rawValue)
  assert.equal(state.credential.state, 'active')
  scenario.firstVersionId = activeVersionId(state.credential)
  await setupSelfHostedRunnerSession(state, this, 'REVOCABLE_PROVIDER_KEY')
})

When('a user revokes it', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  state.credential = await apiJson<Json>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}`,
    { method: 'PATCH', data: { state: 'revoked', revokeReason: 'Rotated out by vault e2e' } },
  )
  assert.equal(state.credential.state, 'revoked')
})

Then('future sessions cannot resolve it', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  // New sessions cannot even bind the revoked reference: admission rejects it
  // before any runtime starts.
  const agent = await apiJson<Json>(state.page.request, '/api/v1/agents', {
    method: 'POST',
    data: { name: `${state.runId} post-revoke agent`, instructions: 'Vault revocation e2e agent' },
  })
  const environment = await apiJson<Json>(state.page.request, '/api/v1/environments', {
    method: 'POST',
    data: { name: `${state.runId} post-revoke env`, runtimeConfig: { image: 'ama-pi-runtime' } },
  })
  const sessionAttempt = await apiResponse(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: agent.id,
      environmentId: environment.id,
      runtime: 'ama',
      title: `${state.runId} post-revoke session`,
      secretEnv: [
        {
          name: 'REVOCABLE_PROVIDER_KEY',
          credentialRef: { credentialId: state.credential?.id, versionId: String(scenario.firstVersionId) },
        },
      ],
    },
  })
  assert.equal(sessionAttempt.status(), 400, 'revoked credential references must be rejected at admission')
  const body = await sessionAttempt.text()
  assert.match(body, /must exist, be active/)
  assert.equal(body.includes(String(scenario.rawValue)), false)
})

Then(
  'running sessions receive a policy-safe runtime error at the next credential resolution point',
  async function (this: VaultWorld) {
    const state = await ensureVault(this)
    const scenario = flow(this)
    const sessionId = String((scenario.pendingSession as Json).id)
    // Two-step claim: the work item is still available, but leasing it fails
    // when the revoked credential reference cannot be materialized.
    const available = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/v1/work-items?state=available&sessionId=${sessionId}`,
    )
    const workItem = available.data[0]
    assert.ok(workItem, 'the running session still has a work item to lease')
    const claim = await apiResponse(state.page.request, '/api/v1/leases', {
      method: 'POST',
      data: { workItemId: workItem.id, runnerId: state.runner?.id, leaseDurationSeconds: 90 },
    })
    assert.equal(claim.status(), 409, 'revoked credentials must fail lease materialization')
    const body = await claim.text()
    assert.match(body, /revoked/)
    assert.equal(body.includes(String(scenario.rawValue)), false)

    const session = await apiJson<Json>(state.page.request, `/api/v1/sessions/${sessionId}`)
    assert.equal(session.state, 'error')
    assert.match(String(session.stateReason), /revoked/)
    assert.equal(JSON.stringify(session).includes(String(scenario.rawValue)), false)
  },
)

Then('the revocation records an audit event', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const records = await auditRecords(state, 'resourceType=vault_credential&action=vault_credential.revoke')
  const revokeRecord = records.data.find((record) => record.resourceId === state.credential?.id)
  assert.ok(revokeRecord, 'revocation must record an audit event')
  assert.equal(revokeRecord.outcome, 'success')
  assert.equal(JSON.stringify(records).includes(String(flow(this).rawValue)), false)
})

// ─── encryption.feature: Protect secrets at rest and in responses ───

When('credentials or sensitive configuration are stored', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const scenario = flow(this)
  scenario.rawValue = newRawValue(state, 'protect')
  state.credential = await createManagedCredential(state, `${state.runId} protected credential`, scenario.rawValue)
})

Then('raw values are never returned by APIs, events, logs, or UI views', async function (this: VaultWorld) {
  const state = await ensureVault(this)
  const rawValue = String(flow(this).rawValue)

  const credential = await apiJson<Json>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}`,
  )
  assert.equal(JSON.stringify(credential).includes(rawValue), false)
  const versions = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions`,
  )
  assert.equal(JSON.stringify(versions).includes(rawValue), false)
  const records = await auditRecords(state, 'resourceType=vault_credential')
  assert.equal(JSON.stringify(records).includes(rawValue), false)

  // UI view: the vault detail console renders credential metadata only.
  await state.page.goto(`/vaults/${state.vault?.id}`)
  const credentialName = String(state.credential?.name)
  await state.page.getByText(credentialName).first().waitFor({ state: 'visible', timeout: 15_000 })
  const content = await state.page.content()
  assert.equal(content.includes(rawValue), false, 'console views must never render the raw value')
})
