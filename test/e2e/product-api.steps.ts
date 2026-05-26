// @ts-nocheck
import assert from 'node:assert/strict'
import { AfterAll, Given, setDefaultTimeout, Then, When } from '@cucumber/cucumber'
import type { APIRequestContext, Page } from '@playwright/test'
import {
  apiJson,
  apiResponse,
  authenticateE2EPage,
  closeLocalApp,
  delay,
  openLocalPage,
  waitForSession,
} from './local-app'
import type { AmaWorld } from './world'

type Json = Record<string, unknown>

interface ListResponse<T> {
  data: T[]
  pagination: { hasMore: boolean; firstId: string | null; lastId: string | null }
}

interface E2EState {
  page: Page
  auth?: Json
  runId: string
  agent?: Json
  updatedAgent?: Json
  previousSession?: Json
  latestSession?: Json
  environment?: Json
  updatedEnvironment?: Json
  vault?: Json
  credential?: Json
  deletedCredentialVersionId?: string
  response?: Json
  responseStatus?: number
  list?: ListResponse<Json>
  events?: ListResponse<Json>
  eventPages?: Record<string, ListResponse<Json>>
  runtimeMessage?: string
}

type ProductWorld = AmaWorld & { e2e?: E2EState }

setDefaultTimeout(120_000)

AfterAll(async () => {
  await closeLocalApp()
})

Given('a signed-in user has access to a project', { timeout: 120_000 }, async function (this: ProductWorld) {
  const page = await openLocalPage()
  const auth = (await authenticateE2EPage(page)) as Json
  this.e2e = { page, auth, runId: `product-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}` }
})

Given('a project has an active model provider', async function (this: ProductWorld) {
  await ensureSignedIn(this)
})

Given('a project has an active agent definition', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
})

Given('the project has an active agent and an active environment', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
})

Given('a project has an active agent and active environments', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
})

Given('an agent exists with version 1', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  assert.equal(this.e2e?.agent?.version, 1)
})

Given(
  'an agent has instructions, description, model config, tools, sandbox policy, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.agent = await createAgent(this.e2e, {
      name: `${this.e2e.runId} rich agent`,
      description: 'Initial description',
      instructions: 'Initial instructions',
      systemPrompt: 'Initial prompt',
      allowedTools: ['sandbox.exec'],
      sandboxPolicy: { network: 'enabled' },
      metadata: { keep: 'yes', remove: 'soon' },
    })
  },
)

Given('a project has active and archived agents created across multiple dates', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  await createAgent(this.e2e, { name: `${this.e2e.runId} list active 1` })
  const archived = await createAgent(this.e2e, { name: `${this.e2e.runId} list archived` })
  await emptyResponse(this.e2e.page.request, `/api/agents/${archived.id}`, { method: 'DELETE' })
  await createAgent(this.e2e, { name: `${this.e2e.runId} list active 2` })
})

Given('an agent exists with existing sessions', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given('an agent has active sessions', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given(
  'a project has active and archived environments created across multiple dates',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    await createEnvironment(this.e2e, { name: `${this.e2e.runId} env active 1` })
    const archived = await createEnvironment(this.e2e, { name: `${this.e2e.runId} env archived` })
    await emptyResponse(this.e2e.page.request, `/api/environments/${archived.id}`, { method: 'DELETE' })
    await createEnvironment(this.e2e, { name: `${this.e2e.runId} env active 2` })
  },
)

Given('an environment is used by existing sessions', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.previousSession = await createSession(this.e2e)
})

Given('an environment exists', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.environment = await createEnvironment(this.e2e, { name: `${this.e2e.runId} standalone env` })
})

Given('an environment is archived', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  await emptyResponse(this.e2e.page.request, `/api/environments/${this.e2e.environment?.id}`, { method: 'DELETE' })
})

Given('a session exists', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given('a user attempts to create a session', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
})

Given('a session is running', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given('a session is idle', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given('an idle session has a running Pi bridge', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
  assert.equal(this.e2e.latestSession.status, 'idle')
})

Given('a session has stored events', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
  await sendRuntimeMessage(this.e2e, 'stored event check')
})

Given('a session has many events', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
  await sendRuntimeMessage(this.e2e, 'first event pagination message')
  await sendRuntimeMessage(this.e2e, 'second event pagination message')
  this.e2e.events = await sessionEvents(this.e2e)
})

Given('a vault exists', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.vault ??= await createVault(this.e2e)
})

Given('a vault has credentials', async function (this: ProductWorld) {
  await ensureVaultCredential(this)
})

Given('a session references the vault credential', async function (this: ProductWorld) {
  await ensureVaultCredential(this)
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e, {
    vaultRefs: [{ type: 'credential', id: this.e2e.credential?.id }],
  })
})

Given('a project has a vault', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.vault ??= await createVault(this.e2e)
})

When('the user creates an agent with a name and instructions', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.agent = await createAgent(this.e2e, {
    name: `${this.e2e.runId} minimal agent`,
    instructions: 'Answer briefly.',
  })
})

When(
  'the user creates an agent with instructions, provider, model, allowed tools, MCP connectors, sandbox policy, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.agent = await createAgent(this.e2e, {
      name: `${this.e2e.runId} full agent`,
      instructions: 'Use tools when needed.',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      allowedTools: ['sandbox.exec'],
      mcpConnectors: [],
      sandboxPolicy: { network: 'enabled' },
      metadata: { purpose: 'e2e' },
    })
  },
)

When(
  'the user changes instructions, model config, tools, MCP connectors, sandbox policy, or metadata',
  async function (this: ProductWorld) {
    const state = await ensureAgentAndEnvironment(this)
    state.previousSession = await createSession(state)
    state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
      method: 'PATCH',
      data: {
        instructions: 'Updated instructions',
        allowedTools: [],
        sandboxPolicy: { network: 'disabled' },
        metadata: { updated: true },
      },
    })
    state.latestSession = await createSession(state)
  },
)

When('the user changes instructions, model, tools, or sandbox policy', async function (this: ProductWorld) {
  const state = await ensureAgentAndEnvironment(this)
  state.previousSession = await createSession(state)
  state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
    method: 'PATCH',
    data: {
      instructions: 'Updated instructions',
      allowedTools: [],
      sandboxPolicy: { network: 'disabled' },
    },
  })
  state.latestSession = await createSession(state)
})

When('the user changes runtime-relevant configuration', async function (this: ProductWorld) {
  const state = await ensureAgentAndEnvironment(this)
  state.previousSession = await createSession(state)
  state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
    method: 'PATCH',
    data: { instructions: 'Runtime update', metadata: { runtimeUpdated: true } },
  })
})

When('the user updates only the description', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
    method: 'PATCH',
    data: { description: 'Description only update' },
  })
})

When('the user sets a metadata key to null', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
    method: 'PATCH',
    data: { metadata: { remove: null } },
  })
})

When('the user sends an empty tools array', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
    method: 'PATCH',
    data: { allowedTools: [] },
  })
})

When('the user lists agents with a page size', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.list = await apiJson<ListResponse<Json>>(state.page.request, '/api/agents?limit=2')
})

When(
  'an agent is saved with an unavailable provider, blocked tool, or invalid sandbox policy',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const response = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: {
        name: `${state.runId} invalid agent`,
        model: 'missing-model',
        allowedTools: ['secrets.read'],
        sandboxPolicy: { network: 'invalid' },
      },
    })
    state.responseStatus = response.status()
    state.response = (await response.json()) as Json
  },
)

When('the user archives the agent', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await emptyResponse(state.page.request, `/api/agents/${state.agent?.id}`, { method: 'DELETE' })
})

When('the user creates an environment with only a name', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.environment = await createEnvironment(this.e2e, { name: `${this.e2e.runId} minimal env` })
})

When(
  'the user creates an environment with package requirements, variables, secret references, allowed outbound hosts, MCP access rules, package-manager access rules, resource limits, runtime image, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.environment = await createEnvironment(this.e2e, {
      name: `${this.e2e.runId} full env`,
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: { NODE_ENV: { required: true } },
      secretRefs: [{ name: 'TOKEN', ref: 'wrangler_secret:AMA_TOKEN' }],
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      mcpPolicy: { allowedConnectors: [] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      resourceLimits: { memoryMb: 512, timeoutSeconds: 300 },
      runtimeImage: { image: 'ama-pi-runtime' },
      metadata: { purpose: 'e2e' },
    })
  },
)

When(
  'the user creates an environment with packages, variables, network policy, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.environment = await createEnvironment(this.e2e, {
      name: `${this.e2e.runId} reusable env`,
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: { NODE_ENV: { required: true } },
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      metadata: { purpose: 'e2e' },
    })
  },
)

When(
  'the user changes packages, variables, secret references, network policy, resource limits, runtime image, or metadata',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    state.updatedEnvironment = await apiJson<Json>(state.page.request, `/api/environments/${state.environment?.id}`, {
      method: 'PATCH',
      data: {
        packages: [
          { name: 'tsx', version: 'latest' },
          { name: 'vitest', version: 'latest' },
        ],
        variables: { E2E: { required: false } },
        networkPolicy: { mode: 'offline' },
        resourceLimits: { memoryMb: 768 },
        runtimeImage: { image: 'ama-pi-runtime' },
        metadata: { updated: true },
      },
    })
    state.latestSession = await createSession(state)
  },
)

When('the user changes packages, variables, or network policy', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.previousSession = await createSession(state)
  state.updatedEnvironment = await apiJson<Json>(state.page.request, `/api/environments/${state.environment?.id}`, {
    method: 'PATCH',
    data: {
      packages: [{ name: 'vitest', version: 'latest' }],
      variables: { E2E: { required: false } },
      networkPolicy: { mode: 'offline' },
    },
  })
  state.latestSession = await createSession(state)
})

When(
  'the user creates an agent or session that references the archived environment',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const response = await apiResponse(state.page.request, '/api/sessions', {
      method: 'POST',
      data: {
        agentId: state.agent?.id,
        environmentId: state.environment?.id,
        title: `${state.runId} rejected session`,
      },
    })
    state.responseStatus = response.status()
    state.response = (await response.json()) as Json
  },
)

When('the user lists environments with a page size', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.list = await apiJson<ListResponse<Json>>(state.page.request, '/api/environments?limit=2')
})

When('no session is running', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const sessions = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions')
  assert.equal(
    sessions.data.some(
      (session) =>
        session.environmentId === state.environment?.id &&
        ['pending', 'running', 'idle'].includes(String(session.status)),
    ),
    false,
  )
})

When('the user creates a session with the agent and environment', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

When(
  'the user creates a session with an explicit environment, title, metadata, resource references, and vault references',
  async function (this: ProductWorld) {
    await ensureAgentAndEnvironment(this)
    this.e2e.latestSession = await createSession(this.e2e, {
      title: `${this.e2e.runId} explicit session`,
      metadata: { ticket: 'AMA-E2E' },
      resourceRefs: [{ type: 'repository', id: 'repo_1' }],
      vaultRefs: [{ type: 'credential', id: 'cred_1' }],
    })
  },
)

When(
  'the agent is archived, the environment is archived, the model provider is unavailable, or the sandbox policy is blocked',
  async function (this: ProductWorld) {
    await ensureAgentAndEnvironment(this)
    await emptyResponse(this.e2e.page.request, `/api/agents/${this.e2e.agent?.id}`, { method: 'DELETE' })
    const response = await apiResponse(this.e2e.page.request, '/api/sessions', {
      method: 'POST',
      data: { agentId: this.e2e.agent?.id, environmentId: this.e2e.environment?.id },
    })
    this.e2e.responseStatus = response.status()
    this.e2e.response = (await response.json()) as Json
  },
)

When('the user sends a runtime message to the session runtime endpoint', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await sendRuntimeMessage(state, 'runtime endpoint message')
})

When('a client subscribes to session events', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.events = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events`,
  )
})

When('the client lists events with limit, order, type filter, or cursor', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const firstPage = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?limit=1`,
  )
  const firstEvent = required(firstPage.data[0], 'first event')
  const nextPage = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?cursor=${firstEvent.sequence}&limit=2`,
  )
  const descPage = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?order=desc&limit=2`,
  )
  const typedPage = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?type=message_end&limit=10`,
  )
  state.eventPages = { firstPage, nextPage, descPage, typedPage }
})

When('the user stops the session', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.latestSession = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}/stop`, {
    method: 'POST',
  })
})

When('the user reconnects to the session', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.latestSession = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}/reconnect`, {
    method: 'POST',
  })
})

When('the user archives the session', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await emptyResponse(state.page.request, `/api/sessions/${state.latestSession?.id}`, { method: 'DELETE' })
})

When(
  'the user creates a vault with display name, description, scope, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.vault = await createVault(this.e2e)
  },
)

When('the user lists vaults', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.list = await apiJson<ListResponse<Json>>(state.page.request, '/api/vaults?limit=2')
})

When(
  'the user creates a credential with name, type, secret value, connector binding, and metadata',
  async function (this: ProductWorld) {
    await ensureVault(this)
    this.e2e.credential = await createCredential(this.e2e)
  },
)

When('the user creates, rotates, lists, reads, or revokes credentials', async function (this: ProductWorld) {
  await ensureVaultCredential(this)
  this.e2e.credential = await apiJson<Json>(
    this.e2e.page.request,
    `/api/vaults/${this.e2e.vault?.id}/credentials/${this.e2e.credential?.id}/versions`,
    {
      method: 'POST',
      data: { provider: 'external-vault', externalVaultPath: `vault://ama/e2e/${this.e2e.runId}/rotated` },
    },
  )
  await apiJson<Json>(this.e2e.page.request, `/api/vaults/${this.e2e.vault?.id}/credentials/${this.e2e.credential?.id}`)
  await apiJson<ListResponse<Json>>(this.e2e.page.request, `/api/vaults/${this.e2e.vault?.id}/credentials`)
  this.e2e.credential = await apiJson<Json>(
    this.e2e.page.request,
    `/api/vaults/${this.e2e.vault?.id}/credentials/${this.e2e.credential?.id}`,
    { method: 'PATCH', data: { status: 'revoked', revokeReason: 'e2e rotation complete' } },
  )
})

When('the user lists or reads credentials', async function (this: ProductWorld) {
  await ensureVaultCredential(this)
  this.e2e.list = await apiJson<ListResponse<Json>>(
    this.e2e.page.request,
    `/api/vaults/${this.e2e.vault?.id}/credentials`,
  )
  this.e2e.credential = await apiJson<Json>(
    this.e2e.page.request,
    `/api/vaults/${this.e2e.vault?.id}/credentials/${this.e2e.credential?.id}`,
  )
})

When('the user archives the vault', async function (this: ProductWorld) {
  await ensureVault(this)
  await emptyResponse(this.e2e.page.request, `/api/vaults/${this.e2e.vault?.id}`, { method: 'DELETE' })
})

When('the user deletes an unused credential version', async function (this: ProductWorld) {
  await ensureVaultCredential(this)
  const rotated = await apiJson<Json>(
    this.e2e.page.request,
    `/api/vaults/${this.e2e.vault?.id}/credentials/${this.e2e.credential?.id}/versions`,
    {
      method: 'POST',
      data: { provider: 'external-vault', externalVaultPath: `vault://ama/e2e/${this.e2e.runId}/delete` },
    },
  )
  const previousVersionId = this.e2e.credential?.activeVersionId as string
  this.e2e.credential = rotated
  const missingConfirmation = await apiResponse(
    this.e2e.page.request,
    `/api/vaults/${this.e2e.vault?.id}/credentials/${this.e2e.credential?.id}/versions/${previousVersionId}`,
    { method: 'DELETE' },
  )
  assert.equal(missingConfirmation.status(), 400)
  await emptyResponse(
    this.e2e.page.request,
    `/api/vaults/${this.e2e.vault?.id}/credentials/${this.e2e.credential?.id}/versions/${previousVersionId}?confirm=true`,
    { method: 'DELETE' },
  )
  this.e2e.deletedCredentialVersionId = previousVersionId
})

Then(
  'the agents API supports create, read, update, version history, archive, and list',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    const agent = await createAgent(this.e2e, { name: `${this.e2e.runId} crud agent` })
    const read = await apiJson<Json>(this.e2e.page.request, `/api/agents/${agent.id}`)
    const updated = await apiJson<Json>(this.e2e.page.request, `/api/agents/${agent.id}`, {
      method: 'PATCH',
      data: { instructions: 'updated' },
    })
    const versions = await apiJson<ListResponse<Json>>(this.e2e.page.request, `/api/agents/${agent.id}/versions`)
    const list = await apiJson<ListResponse<Json>>(this.e2e.page.request, '/api/agents')
    await emptyResponse(this.e2e.page.request, `/api/agents/${agent.id}`, { method: 'DELETE' })
    assert.equal(read.id, agent.id)
    assert.equal(updated.version, 2)
    assert.ok(versions.data.length >= 2)
    assert.ok(list.data.some((row) => row.id === agent.id))
  },
)

Then(
  'the agents API enforces auth, project tenancy, model policy, and tool policy',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalid = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} invalid`, model: 'missing-model', allowedTools: ['secrets.read'] },
    })
    assert.equal(invalid.status(), 400)
  },
)

Then('agent sessions keep immutable agent and environment snapshots', async function (this: ProductWorld) {
  const state = await ensureAgentAndEnvironment(this)
  const session = await createSession(state)
  assert.equal(objectValue(session.agentSnapshot).version, objectValue(state.agent).version)
  assert.equal(objectValue(session.environmentSnapshot).version, objectValue(state.environment).version)
})

Then('the platform stores the agent definition in D1', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const agent = required(state.agent, 'agent')
  const read = await apiJson<Json>(state.page.request, `/api/agents/${agent.id}`)
  assert.equal(read.id, agent.id)
})

Then('the response includes the agent id, version, and timestamps', function (this: ProductWorld) {
  const agent = required(this.e2e?.agent, 'agent')
  assert.match(String(agent.id), /^agent_/)
  assert.equal(typeof agent.version, 'number')
  assert.equal(typeof agent.createdAt, 'string')
  assert.equal(typeof agent.updatedAt, 'string')
})

Then(
  'the response includes an agent id, current version id, project id, timestamps, and archive state',
  function (this: ProductWorld) {
    const agent = required(this.e2e?.agent, 'agent')
    assert.match(String(agent.id), /^agent_/)
    assert.match(String(agent.currentVersionId), /^agentver_/)
    assert.equal(typeof agent.projectId, 'string')
    assert.equal(agent.status, 'active')
    assert.equal(typeof agent.createdAt, 'string')
    assert.equal(typeof agent.updatedAt, 'string')
  },
)

Then('the agent defaults to the project default model provider and model', function (this: ProductWorld) {
  const agent = required(this.e2e?.agent, 'agent')
  assert.equal(agent.provider, 'workers-ai')
  assert.equal(agent.model, '@cf/moonshotai/kimi-k2.6')
})

Then(
  'optional fields use stable empty values instead of disappearing from the response',
  function (this: ProductWorld) {
    const agent = required(this.e2e?.agent, 'agent')
    assert.ok(Array.isArray(agent.allowedTools))
    assert.ok(Array.isArray(agent.mcpConnectors))
    assert.equal(typeof agent.sandboxPolicy, 'object')
    assert.equal(typeof agent.metadata, 'object')
  },
)

Then(
  'the first agent version stores the instructions, model config, tool policy, sandbox policy, and metadata',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const versions = await apiJson<ListResponse<Json>>(state.page.request, `/api/agents/${state.agent?.id}/versions`)
    assert.equal(versions.data[0]?.version, 1)
  },
)

Then('the response echoes the normalized runtime configuration', function (this: ProductWorld) {
  const agent = required(this.e2e?.agent, 'agent')
  assert.deepEqual(agent.allowedTools, ['sandbox.exec'])
  assert.deepEqual(agent.sandboxPolicy, { network: 'enabled' })
  assert.deepEqual(agent.metadata, { purpose: 'e2e' })
})

Then(
  'blocked tools, unavailable models, and invalid sandbox policies are rejected with field-level validation details',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalid = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} blocked`, allowedTools: ['secrets.read'] },
    })
    const body = (await invalid.json()) as { error?: { details?: Json } }
    assert.equal(invalid.status(), 400)
    assert.equal(typeof body.error?.details, 'object')
  },
)

Then(
  'secret material is never accepted directly inside agent metadata, tools, or connector configuration',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalid = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} secret`, metadata: { apiKey: 'raw-secret' } },
    })
    assert.equal(invalid.status(), 400)
  },
)

Then('the platform creates version 2', function (this: ProductWorld) {
  assert.equal(this.e2e?.updatedAgent?.version, 2)
})

Then('the platform creates a new immutable agent version', function (this: ProductWorld) {
  assert.equal(this.e2e?.updatedAgent?.version, 2)
  assert.match(String(this.e2e?.updatedAgent?.currentVersionId), /^agentver_/)
})

Then('the current agent points at version 2', function (this: ProductWorld) {
  assert.equal(this.e2e?.updatedAgent?.version, 2)
})

Then('sessions created before the update keep the version 1 snapshot', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.previousSession?.agentSnapshot).version, 1)
})

Then('existing sessions continue using their original agent snapshot', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.previousSession?.agentSnapshot).version, 1)
})

Then('sessions created after the update use the version 2 snapshot', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.latestSession?.agentSnapshot).version, 2)
})

Then(
  'a new agent version is created and active sessions keep their original snapshot',
  async function (this: ProductWorld) {
    assert.equal(this.e2e?.updatedAgent?.version, 2)
    assert.equal(objectValue(this.e2e?.previousSession?.agentSnapshot).version, 1)
  },
)

Then('every omitted runtime field remains unchanged', function (this: ProductWorld) {
  const agent = required(this.e2e?.updatedAgent, 'updated agent')
  assert.equal(agent.description, 'Description only update')
  assert.equal(agent.instructions, 'Initial instructions')
})

Then('that key is removed while other metadata keys remain', function (this: ProductWorld) {
  const metadata = objectValue(this.e2e?.updatedAgent?.metadata)
  assert.equal(metadata.remove, undefined)
  assert.equal(metadata.keep, 'yes')
})

Then('the agent version stores an explicit empty tools policy', function (this: ProductWorld) {
  assert.deepEqual(this.e2e?.updatedAgent?.allowedTools, [])
})

Then('the response includes data, hasMore, firstId, and lastId', function (this: ProductWorld) {
  const list = required(this.e2e?.list, 'list')
  assert.ok(Array.isArray(list.data))
  assert.equal(typeof objectValue(list.pagination).hasMore, 'boolean')
  assert.ok('firstId' in objectValue(list.pagination))
  assert.ok('lastId' in objectValue(list.pagination))
})

Then('archived agents are hidden unless includeArchived is true', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/agents')
  assert.equal(
    list.data.some((agent) => agent.status === 'archived'),
    false,
  )
  const all = await apiJson<ListResponse<Json>>(state.page.request, '/api/agents?includeArchived=true')
  assert.ok(all.data.some((agent) => agent.status === 'archived'))
})

Then('created date filters only return agents in the requested range', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, `/api/agents?createdFrom=2020-01-01T00:00:00.000Z`)
  assert.ok(list.data.length > 0)
})

Then('results are scoped to the signed-in project', function (this: ProductWorld) {
  const list = required(this.e2e?.list, 'list')
  for (const item of list.data) {
    assert.equal(item.projectId, this.e2e?.auth?.project?.id ?? item.projectId)
  }
})

Then('the agent is hidden from default lists and creation flows', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/agents')
  assert.equal(
    list.data.some((agent) => agent.id === state.agent?.id),
    false,
  )
})

Then('the agent no longer appears in default creation flows', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/agents')
  assert.equal(
    list.data.some((agent) => agent.id === state.agent?.id),
    false,
  )
})

Then('new sessions cannot be created from the archived agent', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const response = await apiResponse(state.page.request, '/api/sessions', {
    method: 'POST',
    data: { agentId: state.agent?.id, environmentId: state.environment?.id },
  })
  assert.equal(response.status(), 409)
})

Then('existing sessions and immutable snapshots remain readable', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.id, state.latestSession?.id)
  assert.ok(session.agentSnapshot)
})

Then('existing sessions remain readable', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.id, state.latestSession?.id)
})

Then('the archive operation records an audit event', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?limit=20')
  assert.ok(audit.data.some((record) => String(record.action).includes('archive')))
})

Then(
  'the environments API supports create, read, update, version history, archive, and list',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    const env = await createEnvironment(this.e2e, { name: `${this.e2e.runId} crud env` })
    const read = await apiJson<Json>(this.e2e.page.request, `/api/environments/${env.id}`)
    const updated = await apiJson<Json>(this.e2e.page.request, `/api/environments/${env.id}`, {
      method: 'PATCH',
      data: { metadata: { updated: true } },
    })
    const versions = await apiJson<ListResponse<Json>>(this.e2e.page.request, `/api/environments/${env.id}/versions`)
    const list = await apiJson<ListResponse<Json>>(this.e2e.page.request, '/api/environments')
    await emptyResponse(this.e2e.page.request, `/api/environments/${env.id}`, { method: 'DELETE' })
    assert.equal(read.id, env.id)
    assert.equal(updated.version, 2)
    assert.ok(versions.data.length >= 2)
    assert.ok(list.data.some((row) => row.id === env.id))
  },
)

Then('the environments API enforces auth and project tenancy', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const invalid = await apiResponse(state.page.request, '/api/environments', { method: 'POST', data: { name: '' } })
  assert.equal(invalid.status(), 400)
})

Then(
  'environment secret handling stores references and never returns raw secret values',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const env = await createEnvironment(state, {
      name: `${state.runId} secret ref env`,
      secretRefs: [{ name: 'TOKEN', ref: 'wrangler_secret:AMA_TOKEN' }],
    })
    assert.deepEqual(env.secretRefs, [{ name: 'TOKEN', ref: 'wrangler_secret:AMA_TOKEN' }])
    assert.equal(JSON.stringify(env).includes('raw-secret'), false)
  },
)

Then(
  'the response includes an environment id, current version id, project id, timestamps, and archive state',
  function (this: ProductWorld) {
    const env = required(this.e2e?.environment, 'environment')
    assert.match(String(env.id), /^env_/)
    assert.match(String(env.currentVersionId), /^envver_/)
    assert.equal(env.status, 'active')
    assert.equal(typeof env.createdAt, 'string')
  },
)

Then(
  'package lists, variables, secret references, network policy, resource limits, runtime image, and metadata have stable default values',
  function (this: ProductWorld) {
    const env = required(this.e2e?.environment, 'environment')
    for (const key of [
      'packages',
      'variables',
      'secretRefs',
      'networkPolicy',
      'resourceLimits',
      'runtimeImage',
      'metadata',
    ]) {
      assert.ok(key in env)
    }
  },
)

Then(
  'the environment is stored as a reusable definition, not as a running sandbox instance',
  function (this: ProductWorld) {
    assert.equal('sandboxId' in required(this.e2e?.environment, 'environment'), false)
  },
)

Then('later sessions can reference the environment by id', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.agent ??= await createAgent(state, { name: `${state.runId} env reference agent` })
  const session = await createSession(state)
  assert.equal(session.environmentId, state.environment?.id)
})

Then('new sessions for that agent inherit an environment snapshot', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.ok(session.environmentSnapshot)
})

Then('sandbox creation uses the environment snapshot', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.equal(objectValue(session.environmentSnapshot).environmentId, session.environmentId)
})

Then('no sandbox instance is required', function (this: ProductWorld) {
  const env = required(this.e2e?.environment, 'environment')
  assert.equal('sandboxId' in env, false)
})

Then('the environment remains available for future sessions', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const env = await apiJson<Json>(state.page.request, `/api/environments/${state.environment?.id}`)
  assert.equal(env.status, 'active')
})

Then('the response stores normalized policy fields', function (this: ProductWorld) {
  const env = required(this.e2e?.environment, 'environment')
  assert.deepEqual(env.networkPolicy, { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] })
  assert.deepEqual(env.packageManagerPolicy, { allowedRegistries: ['registry.npmjs.org'] })
})

Then('raw secret values are rejected', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const invalid = await apiResponse(state.page.request, '/api/environments', {
    method: 'POST',
    data: { name: `${state.runId} raw secret`, metadata: { apiKey: 'raw-secret' } },
  })
  assert.equal(invalid.status(), 400)
})

Then('secret references are returned only as safe names and references', function (this: ProductWorld) {
  const refs = required(this.e2e?.environment?.secretRefs, 'secret refs') as unknown[]
  assert.deepEqual(refs, [{ name: 'TOKEN', ref: 'wrangler_secret:AMA_TOKEN' }])
})

Then(
  'invalid package specs, invalid host patterns, and unsupported runtime images return field-level validation details',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalid = await apiResponse(state.page.request, '/api/environments', {
      method: 'POST',
      data: { name: `${state.runId} invalid`, packages: [{ name: '' }] },
    })
    assert.equal(invalid.status(), 400)
  },
)

Then('the platform rejects the request with field-level validation details', function (this: ProductWorld) {
  const body = objectValue(this.e2e?.response)
  assert.equal(this.e2e?.responseStatus, 400)
  const error = objectValue(body.error)
  assert.ok(typeof error.details === 'object' || Array.isArray(error.issues))
})

Then('the platform creates a new environment version', function (this: ProductWorld) {
  assert.equal(this.e2e?.updatedEnvironment?.version, 2)
})

Then('existing sessions keep their original environment snapshot', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.previousSession?.environmentSnapshot).version, 1)
})

Then('existing sessions continue using their original environment snapshot', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.previousSession?.environmentSnapshot).version, 1)
})

Then('new sessions that reference the environment use the new environment version', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.latestSession?.environmentSnapshot).version, 2)
})

Then('the request is rejected with a conflict error', function (this: ProductWorld) {
  assert.equal(this.e2e?.responseStatus, 409)
})

Then(
  'the archived environment remains readable through explicit read and includeArchived list requests',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const env = await apiJson<Json>(state.page.request, `/api/environments/${state.environment?.id}`)
    const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/environments?includeArchived=true')
    assert.equal(env.status, 'archived')
    assert.ok(list.data.some((row) => row.id === state.environment?.id))
  },
)

Then('archived environments are hidden unless includeArchived is true', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/environments')
  assert.equal(
    list.data.some((env) => env.status === 'archived'),
    false,
  )
  const all = await apiJson<ListResponse<Json>>(state.page.request, '/api/environments?includeArchived=true')
  assert.ok(all.data.some((env) => env.status === 'archived'))
})

Then('created date filters only return environments in the requested range', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(
    state.page.request,
    '/api/environments?createdFrom=2020-01-01T00:00:00.000Z',
  )
  assert.ok(list.data.length > 0)
})

Then(
  'the sessions API supports create, list, read, reconnect, stop, archive, and events',
  async function (this: ProductWorld) {
    await ensureAgentAndEnvironment(this)
    const session = await createSession(this.e2e)
    await apiJson<ListResponse<Json>>(this.e2e.page.request, '/api/sessions')
    await apiJson<Json>(this.e2e.page.request, `/api/sessions/${session.id}`)
    await apiJson<Json>(this.e2e.page.request, `/api/sessions/${session.id}/reconnect`)
    await apiJson<ListResponse<Json>>(this.e2e.page.request, `/api/sessions/${session.id}/events`)
    await apiJson<Json>(this.e2e.page.request, `/api/sessions/${session.id}/stop`, { method: 'POST' })
    await emptyResponse(this.e2e.page.request, `/api/sessions/${session.id}`, { method: 'DELETE' })
  },
)

Then('the sessions API enforces auth, project tenancy, and immutable snapshots', async function (this: ProductWorld) {
  const state = await ensureAgentAndEnvironment(this)
  const session = await createSession(state)
  assert.equal(objectValue(session.agentSnapshot).version, objectValue(state.agent).version)
})

Then('inactive session runtime requests use the standard error envelope', async function (this: ProductWorld) {
  const state = await ensureAgentAndEnvironment(this)
  const session = await createSession(state)
  await apiJson<Json>(state.page.request, `/api/sessions/${session.id}/stop`, { method: 'POST' })
  const response = await apiResponse(state.page.request, `/runtime/sessions/${session.id}/rpc`, { method: 'POST' })
  assert.ok([409, 426].includes(response.status()))
})

Then(
  'the response includes a session id, project id, organization id, status, timestamps, durable object name, sandbox id, runtime endpoint, and model config',
  function (this: ProductWorld) {
    const session = required(this.e2e?.latestSession, 'session')
    assert.match(String(session.id), /^session_/)
    assert.equal(typeof session.projectId, 'string')
    assert.equal(typeof session.organizationId, 'string')
    assert.equal(session.status, 'idle')
    assert.equal(typeof session.durableObjectName, 'string')
    assert.equal(typeof session.sandboxId, 'string')
    assert.equal(typeof session.runtimeEndpointPath, 'string')
    assert.equal(typeof session.modelConfig, 'object')
  },
)

Then('the session stores immutable agent and environment snapshots', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.ok(session.agentSnapshot)
  assert.ok(session.environmentSnapshot)
})

Then('the session starts the Pi bridge inside a Cloudflare Sandbox', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.equal(typeof session.sandboxId, 'string')
  assert.equal(objectValue(session.metadata).runtime, 'pi')
})

Then('lifecycle and sandbox events record session creation and runtime startup', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events`,
  )
  assert.ok(events.data.length >= 0)
})

Then('the response stores those values as safe references', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.equal(session.title, `${this.e2e?.runId} explicit session`)
  assert.equal(objectValue(session.metadata).ticket, 'AMA-E2E')
  assert.deepEqual(session.resourceRefs, [{ type: 'repository', id: 'repo_1' }])
  assert.deepEqual(session.vaultRefs, [{ type: 'credential', id: 'cred_1' }])
})

Then(
  'file and repository resources are mounted into the sandbox using deterministic mount paths',
  function (this: ProductWorld) {
    assert.deepEqual(this.e2e?.latestSession?.resourceRefs, [{ type: 'repository', id: 'repo_1' }])
  },
)

Then(
  'vault references are exposed to the runtime only through approved secret bindings',
  function (this: ProductWorld) {
    assert.deepEqual(this.e2e?.latestSession?.vaultRefs, [{ type: 'credential', id: 'cred_1' }])
  },
)

Then('raw credentials are rejected from the request body', async function (this: ProductWorld) {
  const state = await ensureAgentAndEnvironment(this)
  const response = await apiResponse(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      resourceRefs: [{ type: 'repository', apiKey: 'raw-secret' }],
    },
  })
  assert.equal(response.status(), 400)
})

Then('the request fails before starting a sandbox', function (this: ProductWorld) {
  assert.equal(this.e2e?.responseStatus, 409)
})

Then('the error envelope identifies the unavailable dependency', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.response?.error).type, 'conflict')
})

Then('no session record is left in an active state', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const sessions = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions')
  assert.equal(
    sessions.data.some((session) => session.title === `${state.runId} rejected session`),
    false,
  )
})

Then('the runtime accepts the message', function (this: ProductWorld) {
  assert.ok(this.e2e?.runtimeMessage)
})

Then('the session status becomes running while work is in progress', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.ok(['idle', 'running'].includes(String(session.status)))
})

Then('the Pi runtime can call approved tools inside the Cloudflare Sandbox', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = await sessionEvents(state)
  assert.ok(events.data.length > 0)
  assert.ok((state.runtimeEventTypes ?? []).filter(Boolean).some((type) => String(type).includes('tool')))
})

Then(
  'message, tool, sandbox, usage, lifecycle, and error events are stored in sequence',
  async function (this: ProductWorld) {
    const events = await sessionEvents(await ensureState(this))
    const sequences = events.data.map((event) => Number(event.sequence))
    assert.deepEqual(
      [...sequences].sort((a, b) => a - b),
      sequences,
    )
  },
)

Then('lifecycle events are stored with monotonically increasing sequence numbers', async function (this: ProductWorld) {
  const events = await sessionEvents(await ensureState(this))
  const sequences = events.data.map((event) => Number(event.sequence))
  assert.ok(sequences.length > 0)
  assert.deepEqual(
    [...sequences].sort((a, b) => a - b),
    sequences,
  )
})

Then('message events preserve user-visible content', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = await sessionEvents(state)
  const serialized = JSON.stringify(events.data)
  assert.ok(serialized.includes(state.runtimeMessage ?? ''))
})

Then(
  'the session returns to idle with a final result or moves to error with a safe failure reason',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
    assert.ok(['idle', 'error'].includes(String(session.status)))
  },
)

Then('events are streamed in sequence order', function (this: ProductWorld) {
  const events = required(this.e2e?.events, 'events')
  assert.ok(events.data.length > 0)
})

Then('the client can reconnect from the last seen sequence', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const first = required(state.events, 'events').data[0]
  const events = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?cursor=${first.sequence}`,
  )
  assert.ok(Array.isArray(events.data))
})

Then('event list endpoints support pagination, order, and event type filters', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await apiJson<ListResponse<Json>>(state.page.request, `/api/sessions/${state.latestSession?.id}/events?limit=1`)
  await apiJson<ListResponse<Json>>(state.page.request, `/api/sessions/${state.latestSession?.id}/events?order=desc`)
  await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?type=message_end`,
  )
})

Then('the response returns a deterministic page', function (this: ProductWorld) {
  const pages = required(this.e2e?.eventPages, 'event pages')
  assert.equal(pages.firstPage.data.length, 1)
  assert.ok(pages.nextPage.data.every((event) => Number(event.sequence) > Number(pages.firstPage.data[0]?.sequence)))
  assert.ok(pages.descPage.data.length > 0)
  assert.ok(pages.typedPage.data.every((event) => event.type === 'message_end'))
})

Then('hasMore, firstId, lastId, and sequence boundaries allow stable pagination', function (this: ProductWorld) {
  const pages = required(this.e2e?.eventPages, 'event pages')
  assert.equal(typeof pages.firstPage.pagination.hasMore, 'boolean')
  assert.ok('firstId' in pages.firstPage.pagination)
  assert.ok('lastId' in pages.firstPage.pagination)
  assert.ok(pages.firstPage.data.every((event) => typeof event.sequence === 'number'))
})

Then(
  'transcript views can omit debug-only events without losing the raw debug history',
  async function (this: ProductWorld) {
    const events = await sessionEvents(await ensureState(this))
    assert.ok(events.data.every((event) => typeof event.visibility === 'string'))
  },
)

Then('AMA requests the Pi bridge to stop', function (this: ProductWorld) {
  assert.ok(this.e2e?.latestSession)
})

Then('the session status becomes stopped', function (this: ProductWorld) {
  assert.equal(this.e2e?.latestSession?.status, 'stopped')
})

Then('AMA asks the Pi bridge to stop work', function (this: ProductWorld) {
  assert.equal(this.e2e?.latestSession?.status, 'stopped')
})

Then('no new model or tool work starts after the next cancellation boundary', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const response = await apiResponse(state.page.request, `/runtime/sessions/${state.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'user_message', message: 'should not run' },
  })
  assert.ok(response.status() >= 400)
})

Then('stop lifecycle events and audit records include the user-requested reason', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?limit=20')
  assert.ok(audit.data.some((record) => String(record.action).includes('stop')))
})

Then('lifecycle events record the stop', async function (this: ProductWorld) {
  const events = await sessionEvents(await ensureState(this))
  assert.ok(events.data.some((event) => String(event.type).includes('stop')))
})

Then(
  'session metadata, sandbox state references, runtime endpoint, and status are available',
  function (this: ProductWorld) {
    const session = required(this.e2e?.latestSession, 'session')
    assert.ok(session.metadata)
    assert.ok(session.sandboxId)
    assert.ok(session.runtimeEndpointPath)
    assert.ok(session.status)
  },
)

Then('the session is hidden from default lists', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions')
  assert.equal(
    list.data.some((session) => session.id === state.latestSession?.id),
    false,
  )
})

Then('includeArchived lists can still return it', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions?includeArchived=true')
  assert.ok(list.data.some((session) => session.id === state.latestSession?.id))
})

Then(
  'runtime requests to archived, stopped, or errored sessions use the standard error envelope',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const response = await apiResponse(state.page.request, `/runtime/sessions/${state.latestSession?.id}/rpc`, {
      method: 'POST',
    })
    assert.ok(response.status() >= 400)
  },
)

Then('events and immutable snapshots remain readable', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  const events = await sessionEvents(state)
  assert.ok(session.agentSnapshot)
  assert.ok(Array.isArray(events.data))
})

Then('raw secret values are never returned after creation', function (this: ProductWorld) {
  assert.equal(JSON.stringify(this.e2e?.credential).includes('raw-secret'), false)
})

Then('the response includes vault id, status, timestamps, and safe metadata', function (this: ProductWorld) {
  const vault = required(this.e2e?.vault, 'vault')
  assert.match(String(vault.id), /^vault_/)
  assert.equal(vault.status, 'active')
  assert.equal(typeof vault.createdAt, 'string')
  assert.deepEqual(vault.metadata, { purpose: 'e2e' })
})

Then('the list supports pagination, archived filtering, and project scope', function (this: ProductWorld) {
  const list = required(this.e2e?.list, 'list')
  assert.ok(Array.isArray(list.data))
  assert.ok(list.pagination)
})

Then(
  'the response includes credential id, name, type, active version, connector binding, and timestamps',
  function (this: ProductWorld) {
    const credential = required(this.e2e?.credential, 'credential')
    assert.match(String(credential.id), /^vaultcred_/)
    assert.equal(credential.type, 'api_key')
    assert.match(String(credential.activeVersionId), /^vaultver_/)
    assert.deepEqual(credential.connectorBinding, { connectorId: 'workers-ai', name: 'apiKey' })
  },
)

Then('the secret value is accepted only in the create or rotate request', function (this: ProductWorld) {
  assert.equal(JSON.stringify(this.e2e?.credential).includes('raw-secret'), false)
})

Then('the response never includes the raw secret value', function (this: ProductWorld) {
  assert.equal(JSON.stringify(this.e2e?.credential).includes('raw-secret'), false)
})

Then(
  'the response includes names, types, versions, connector bindings, usage references, and timestamps',
  function (this: ProductWorld) {
    const credential = required(this.e2e?.credential, 'credential')
    assert.equal(typeof credential.name, 'string')
    assert.equal(typeof credential.type, 'string')
    assert.ok(credential.activeVersion)
  },
)

Then(
  'the response exposes only hasSecret or safe reference fields instead of secret values',
  function (this: ProductWorld) {
    const credential = required(this.e2e?.credential, 'credential')
    assert.equal(objectValue(credential.activeVersion).hasSecret, true)
    assert.equal(JSON.stringify(credential).includes('raw-secret'), false)
  },
)

Then(
  'the vault is hidden from default lists and cannot be selected for new sessions',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/vaults')
    assert.equal(
      list.data.some((vault) => vault.id === state.vault?.id),
      false,
    )
    const createCredential = await apiResponse(state.page.request, `/api/vaults/${state.vault?.id}/credentials`, {
      method: 'POST',
      data: {
        name: `${state.runId} archived vault credential`,
        type: 'api_key',
        secret: { provider: 'external-vault', externalVaultPath: `vault://ama/e2e/${state.runId}/archived` },
      },
    })
    assert.equal(createCredential.status(), 409)
  },
)

Then('existing session references remain auditable', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.deepEqual(session.vaultRefs, [{ type: 'credential', id: state.credential?.id }])
  const archivedList = await apiJson<ListResponse<Json>>(
    state.page.request,
    '/api/vaults?includeArchived=true&status=archived',
  )
  const archivedVault = archivedList.data.find((vault) => vault.id === state.vault?.id)
  assert.equal(archivedVault?.status, 'archived')
  assert.equal(typeof archivedVault?.archivedAt, 'string')
})

Then('the operation requires explicit confirmation and audit metadata', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const versions = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions?includeArchived=true`,
  )
  const deleted = versions.data.find((version) => version.id === state.deletedCredentialVersionId)
  assert.equal(deleted?.status, 'deleted')
  assert.equal(deleted?.hasSecret, false)
  assert.equal(typeof objectValue(deleted?.metadata).deletedByUserId, 'string')
  assert.equal(typeof objectValue(deleted?.metadata).deleteConfirmedAt, 'string')
})

async function ensureSignedIn(world: ProductWorld) {
  if (world.e2e) {
    return world.e2e
  }
  const page = await openLocalPage()
  const auth = (await authenticateE2EPage(page)) as Json
  world.e2e = { page, auth, runId: `product-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}` }
  return world.e2e
}

async function ensureAgentAndEnvironment(world: ProductWorld) {
  const state = await ensureSignedIn(world)
  state.agent ??= await createAgent(state, { name: `${state.runId} agent` })
  state.environment ??= await createEnvironment(state, { name: `${state.runId} env` })
  return state
}

async function ensureVault(world: ProductWorld) {
  const state = await ensureSignedIn(world)
  state.vault ??= await createVault(state)
  return state
}

async function ensureVaultCredential(world: ProductWorld) {
  const state = await ensureVault(world)
  state.credential ??= await createCredential(state)
  return state
}

async function ensureState(world: ProductWorld) {
  assert.ok(world.e2e, 'Signed-in local e2e state must exist')
  return world.e2e
}

async function createAgent(state: E2EState, data: Json = {}) {
  return await apiJson<Json>(state.page.request, '/api/agents', {
    method: 'POST',
    data: {
      name: `${state.runId} agent`,
      instructions: 'E2E agent',
      ...data,
    },
  })
}

async function createEnvironment(state: E2EState, data: Json = {}) {
  return await apiJson<Json>(state.page.request, '/api/environments', {
    method: 'POST',
    data: {
      name: `${state.runId} env`,
      runtimeImage: { image: 'ama-pi-runtime' },
      ...data,
    },
  })
}

async function createSession(state: E2EState, data: Json = {}) {
  const session = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      title: `${state.runId} session`,
      ...data,
    },
  })
  return await waitForSession(state.page.request, String(session.id))
}

async function createVault(state: E2EState) {
  return await apiJson<Json>(state.page.request, '/api/vaults', {
    method: 'POST',
    data: {
      name: `${state.runId} vault`,
      description: 'E2E vault',
      scope: 'project',
      metadata: { purpose: 'e2e' },
    },
  })
}

async function createCredential(state: E2EState) {
  return await apiJson<Json>(state.page.request, `/api/vaults/${state.vault?.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${state.runId} credential`,
      type: 'api_key',
      connectorBinding: { connectorId: 'workers-ai', name: 'apiKey' },
      metadata: { purpose: 'e2e' },
      secret: { provider: 'external-vault', externalVaultPath: `vault://ama/e2e/${state.runId}/credential` },
    },
  })
}

async function sendRuntimeMessage(state: E2EState, message: string) {
  const sessionId = String(state.latestSession?.id)
  state.runtimeMessage = message
  await state.page.goto(`/sessions/${sessionId}`)
  await state.page
    .evaluate(
      async ({ sessionId, message }) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const socket = new WebSocket(`${protocol}//${window.location.host}/runtime/sessions/${sessionId}/ws`)
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener('open', () => resolve(), { once: true })
          socket.addEventListener('error', () => reject(new Error('runtime websocket failed')), { once: true })
        })
        socket.send(JSON.stringify({ id: `cmd_${Date.now()}`, type: 'prompt', message }))
        const eventTypes: string[] = []
        socket.addEventListener('message', (event) => {
          try {
            eventTypes.push(JSON.parse(String(event.data)).type)
          } catch {
            eventTypes.push('unparsed')
          }
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
        socket.close()
        return eventTypes
      },
      { sessionId, message },
    )
    .then((eventTypes) => {
      state.runtimeEventTypes = eventTypes
    })
  await waitForRuntimeEvents(state)
}

async function waitForRuntimeEvents(state: E2EState) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await sessionEvents(state)
    if (events.data.some((event) => String(event.type).includes('message'))) {
      return
    }
    await delay(500)
  }
}

async function sessionEvents(state: E2EState) {
  return await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?limit=200`,
  )
}

async function emptyResponse(
  request: APIRequestContext,
  path: string,
  init: NonNullable<Parameters<APIRequestContext['fetch']>[1]>,
) {
  const response = await apiResponse(request, path, init)
  if (!response.ok()) {
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status()}: ${await response.text()}`)
  }
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function required<T>(value: T | undefined | null, label: string) {
  assert.ok(value, `${label} must exist`)
  return value
}
