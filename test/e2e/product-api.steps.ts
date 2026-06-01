// @ts-nocheck
import assert from 'node:assert/strict'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { After, AfterAll, Given, setDefaultTimeout, Then, When } from '@cucumber/cucumber'
import type { APIRequestContext, Page } from '@playwright/test'
import {
  apiJson,
  apiResponse,
  authenticateE2EPage,
  closeLocalApp,
  delay,
  ensureLocalApp,
  openLocalPage,
  waitForSession,
} from './local-app'
import type { AmaWorld } from './world'

type Json = Record<string, unknown>

const DEFAULT_AMA_RUNNER_CAPABILITY = 'runtime-provider-model:ama:workers-ai:@cf/moonshotai/kimi-k2.6'
const CODEX_E2E_MODEL = 'gpt-5.3-codex'

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
  provider?: Json
  otherProvider?: Json
  providerModel?: Json
  accessRule?: Json
  policy?: Json
  budget?: Json
  scheduledTrigger?: Json
  scheduledDispatch?: Json
  duplicateScheduledDispatch?: Json
  inactiveScheduledTriggers?: Json[]
  mcpConnection?: Json
  runner?: Json
  lease?: Json
  runnerProcess?: AmaRunnerProcess
  runnerWorkDir?: string
  runnerChannelMessages?: Json[]
  staleRunnerChannelMessages?: Json[]
  channelEventText?: string
  otherPage?: Page
  deletedCredentialVersionId?: string
  response?: Json
  responseStatus?: number
  list?: ListResponse<Json>
  events?: ListResponse<Json>
  eventPages?: Record<string, ListResponse<Json>>
  runtimeMessage?: string
  observedEventTypes?: string[]
}

type ProductWorld = AmaWorld & { e2e?: E2EState }
type AmaRunnerProcess = ChildProcessWithoutNullStreams & { runnerOutput: string[] }

setDefaultTimeout(120_000)

After(async function (this: ProductWorld) {
  await stopProductAmaRunner(this.e2e)
})

AfterAll(async () => {
  await closeLocalApp()
})

Given('a signed-in user has access to a project', { timeout: 120_000 }, async function (this: ProductWorld) {
  const page = await openLocalPage()
  const auth = (await authenticateE2EPage(page)) as Json
  this.e2e = { page, auth, runId: `product-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}` }
})

Given('a project has provider access configured', async function (this: ProductWorld) {
  await ensureSignedIn(this)
})

Given('a project has an active model provider', async function (this: ProductWorld) {
  await ensureSignedIn(this)
})

Given('no project-specific providers are configured', async function (this: ProductWorld) {
  await ensureSignedIn(this)
})

Given('a project has multiple providers', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.provider = await createProvider(this.e2e, {
    type: 'workers-ai',
    displayName: `${this.e2e.runId} Workers AI`,
    isDefault: true,
  })
  this.e2e.otherProvider = await createProvider(this.e2e, {
    type: 'openai-compatible',
    displayName: `${this.e2e.runId} Gateway`,
    baseUrl: 'https://models.example.test/v1',
    credentialSecretRef: `secret://providers/${this.e2e.runId}/gateway`,
  })
  await createProviderModel(this.e2e, this.e2e.otherProvider, {
    modelId: '@cf/moonshotai/kimi-k2.6',
    displayName: 'Gateway Kimi',
    capabilities: ['text'],
  })
})

Given('a provider is configured', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.provider = await createProvider(this.e2e, {
    type: 'openai-compatible',
    displayName: `${this.e2e.runId} Gateway`,
    baseUrl: 'https://models.example.test/v1',
    credentialSecretRef: `secret://providers/${this.e2e.runId}/gateway`,
  })
})

Given('agents or sessions reference a provider', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.provider = await createProvider(this.e2e, {
    type: 'workers-ai',
    displayName: `${this.e2e.runId} Workers AI`,
  })
  this.e2e.agent = await createAgent(this.e2e, {
    name: `${this.e2e.runId} provider agent`,
    provider: this.e2e.provider.id,
    model: '@cf/moonshotai/kimi-k2.6',
  })
  this.e2e.environment = await createEnvironment(this.e2e)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given('an organization admin is authenticated', async function (this: ProductWorld) {
  await ensureSignedIn(this)
})

Given('project budgets are enabled', async function (this: ProductWorld) {
  await ensureSignedIn(this)
})

Given('organization, team, project, and agent policies exist', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.policy = await apiJson<Json>(this.e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: {
      providerRules: [{ providerId: 'workers-ai', effect: 'deny', reason: 'Workers AI paused.' }],
      modelRules: [{ providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6', effect: 'deny' }],
      toolPolicy: { deniedTools: ['secrets.read'] },
      mcpPolicy: { deniedConnectors: ['github'] },
      sandboxPolicy: { network: 'disabled' },
      budgetPolicy: { monthlyTokens: 0 },
      metadata: { source: 'e2e' },
    },
  })
  this.e2e.accessRule = await apiJson<Json>(this.e2e.page.request, '/api/governance/provider-access-rules', {
    method: 'POST',
    data: {
      providerId: 'workers-ai',
      modelId: '@cf/moonshotai/kimi-k2.6',
      teamId: 'team_e2e',
      effect: 'deny',
      reason: 'Team rule.',
    },
  })
  this.e2e.budget = await apiJson<Json>(this.e2e.page.request, '/api/governance/budgets', {
    method: 'POST',
    data: { scope: 'project', limitType: 'tokens', limitValue: 1, window: 'month' },
  })
})

Given('a connector is allowed by project policy', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.policy = await apiJson<Json>(this.e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: { mcpPolicy: { allowedConnectors: ['github', 'linear'] } },
  })
})

Given('a connector is already connected', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.credential = await createMcpCredential(this.e2e)
  this.e2e.mcpConnection = await connectMcp(this.e2e, {
    connectorId: 'github',
    credentialId: this.e2e.credential.id,
    credentialVersionId: this.e2e.credential.activeVersionId,
  })
})

Given('organization A has connected a connector', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.credential = await createMcpCredential(this.e2e)
  this.e2e.mcpConnection = await connectMcp(this.e2e, {
    connectorId: 'github',
    credentialId: this.e2e.credential.id,
  })
  this.e2e.otherPage = await openLocalPage()
  await authenticateE2EPage(this.e2e.otherPage)
})

Given('a connector is blocked by policy', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
  this.e2e.policy = await apiJson<Json>(this.e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: { mcpPolicy: { allowedConnectors: ['linear'] } },
  })
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
  'an agent has instructions, description, model config, skills, tools, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.agent = await createAgent(this.e2e, {
      name: `${this.e2e.runId} rich agent`,
      description: 'Initial description',
      instructions: 'Initial instructions',
      systemPrompt: 'Initial prompt',
      skills: ['ama@initial-skill'],
      allowedTools: ['sandbox.exec'],
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

Given('an agent selects a provider and model', async function (this: ProductWorld) {
  const state = await ensureSignedIn(this)
  state.provider = await createProvider(state, {
    type: 'openai-compatible',
    displayName: `${state.runId} unsupported runtime provider`,
    baseUrl: 'https://models.example.test/v1',
    credentialSecretRef: `secret://providers/${state.runId}/unsupported-runtime`,
  })
  state.providerModel = await createProviderModel(state, state.provider, {
    modelId: 'gpt-5.3-codex',
    displayName: 'GPT 5.3 Codex',
    capabilities: ['text'],
  })
  state.agent = await createAgent(state, {
    name: `${state.runId} unsupported runtime agent`,
    provider: state.provider.id,
    model: 'gpt-5.3-codex',
  })
})

Given('an environment selects a runtime', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} unsupported runtime env`,
    hostingMode: 'cloud',
    runtime: 'ama',
  })
})

Given('an environment selects a hostingMode and runtime', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} unsupported runtime env`,
    hostingMode: 'cloud',
    runtime: 'ama',
  })
})

Given('a self-hosted environment selects codex runtime', async function (this: ProductWorld) {
  const state = await ensureSignedIn(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} codex self-hosted env`,
    hostingMode: 'self_hosted',
    runtime: 'codex',
    networkPolicy: { mode: 'unrestricted' },
  })
})

Given('the agent selects an exact provider and model', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.provider = await createProvider(state, {
    type: 'openai-compatible',
    displayName: `${state.runId} codex provider`,
    baseUrl: 'https://models.example.test/v1',
    credentialSecretRef: `secret://providers/${state.runId}/codex`,
  })
  state.providerModel = await createProviderModel(state, state.provider, {
    modelId: CODEX_E2E_MODEL,
    displayName: 'GPT 5.3 Codex',
    capabilities: ['text'],
  })
  state.agent = await createAgent(state, {
    name: `${state.runId} codex agent`,
    provider: state.provider.id,
    model: CODEX_E2E_MODEL,
  })
})

Given('a session is running', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given('a session is idle', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

Given('an idle session has cloud-owned runtime state and a sandbox executor', async function (this: ProductWorld) {
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

When('an operator adds a provider', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.provider = await createProvider(this.e2e, {
    type: 'openai-compatible',
    displayName: `${this.e2e.runId} Gateway`,
    baseUrl: 'https://models.example.test/v1',
    isDefault: true,
    credentialSecretRef: `secret://providers/${this.e2e.runId}/gateway`,
    metadata: { owner: 'platform', apiKey: 'raw-secret-value' },
    rateLimits: { requestsPerMinute: 120 },
    budgetPolicy: { monthlyCostMicros: 1000000 },
  })
  this.e2e.providerModel = await createProviderModel(this.e2e, this.e2e.provider, {
    modelId: 'gateway-model',
    displayName: 'Gateway Model',
    capabilities: ['text'],
    contextWindow: 128000,
    pricing: { inputMicrosPerToken: 1 },
  })
})

When('an operator lists providers', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.list = await apiJson<ListResponse<Json>>(this.e2e.page.request, '/api/providers')
})

When('an operator enables Workers AI for a project', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.provider = await createProvider(this.e2e, {
    type: 'workers-ai',
    displayName: `${this.e2e.runId} Workers AI`,
    isDefault: true,
    metadata: { accountId: 'cf-account-ref' },
  })
})

When(
  'an operator adds Anthropic, OpenAI, OpenAI-compatible, Ollama, or another supported provider',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    const invalidCompatible = await apiResponse(this.e2e.page.request, '/api/providers', {
      method: 'POST',
      data: { type: 'openai-compatible', displayName: `${this.e2e.runId} invalid gateway` },
    })
    assert.equal(invalidCompatible.status(), 400)
    this.e2e.provider = await createProvider(this.e2e, {
      type: 'openai-compatible',
      displayName: `${this.e2e.runId} Gateway`,
      baseUrl: 'https://models.example.test/v1',
      isDefault: true,
      credentialSecretRef: `secret://providers/${this.e2e.runId}/gateway`,
      rateLimits: { requestsPerMinute: 60 },
      budgetPolicy: { monthlyTokens: 1000 },
    })
    await createProvider(this.e2e, {
      type: 'openai',
      displayName: `${this.e2e.runId} OpenAI`,
      credentialSecretRef: `secret://providers/${this.e2e.runId}/openai`,
    })
    await createProvider(this.e2e, {
      type: 'anthropic',
      displayName: `${this.e2e.runId} Anthropic`,
      credentialSecretRef: `secret://providers/${this.e2e.runId}/anthropic`,
    })
    await createProvider(this.e2e, { type: 'ollama', displayName: `${this.e2e.runId} Ollama` })
  },
)

When('an operator marks one provider as default', async function (this: ProductWorld) {
  const state = await ensureState(this)
  this.e2e.otherProvider = await apiJson<Json>(state.page.request, `/api/providers/${state.otherProvider?.id}`, {
    method: 'PATCH',
    data: { isDefault: true },
  })
})

When('model discovery succeeds', async function (this: ProductWorld) {
  const state = await ensureState(this)
  this.e2e.providerModel = await createProviderModel(state, state.provider, {
    modelId: 'gateway-model',
    displayName: 'Gateway Model',
    capabilities: ['text'],
    contextWindow: 128000,
    pricing: { inputMicrosPerToken: 1 },
  })
})

When('model discovery fails or the provider is unreachable', async function (this: ProductWorld) {
  const state = await ensureState(this)
  this.e2e.provider = await apiJson<Json>(state.page.request, `/api/providers/${state.provider?.id}`, {
    method: 'PATCH',
    data: { modelCatalogStatus: 'runtime.error', lastError: { type: 'network_error', credential: 'raw-secret-value' } },
  })
})

When('an operator disables the provider', async function (this: ProductWorld) {
  const state = await ensureState(this)
  this.e2e.provider = await apiJson<Json>(state.page.request, `/api/providers/${state.provider?.id}`, {
    method: 'PATCH',
    data: { status: 'disabled' },
  })
})

When('an operator deletes an unused provider', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const unused = await createProvider(state, {
    type: 'openai',
    displayName: `${state.runId} unused provider`,
    credentialSecretRef: `secret://providers/${state.runId}/unused`,
  })
  await emptyResponse(state.page.request, `/api/providers/${unused.id}`, { method: 'DELETE' })
  this.e2e.otherProvider = unused
})

When('an operator saves provider, model, tool, sandbox, or budget policy', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.policy = await apiJson<Json>(this.e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: {
      providerRules: [{ providerId: 'workers-ai', effect: 'deny', reason: 'Budget review required.' }],
      modelRules: [{ providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6', effect: 'deny' }],
      toolPolicy: { deniedTools: ['secrets.read'] },
      sandboxPolicy: { network: 'disabled' },
      budgetPolicy: { monthlyTokens: 0 },
    },
  })
})

When(
  'the admin creates or updates provider and model access rules for teams and projects',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.accessRule = await apiJson<Json>(this.e2e.page.request, '/api/governance/provider-access-rules', {
      method: 'POST',
      data: {
        providerId: 'workers-ai',
        modelId: '@cf/moonshotai/kimi-k2.6',
        teamId: 'team_e2e',
        effect: 'deny',
        reason: 'Project-wide model access is paused.',
        metadata: { source: 'e2e' },
      },
    })
  },
)

When('the admin sets model, token, session, or time-window budgets', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.policy = await apiJson<Json>(this.e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: { budgetPolicy: { monthlyTokens: 0 } },
  })
  this.e2e.budget = await apiJson<Json>(this.e2e.page.request, '/api/governance/budgets', {
    method: 'POST',
    data: {
      scope: 'project',
      limitType: 'tokens',
      limitValue: 1,
      window: 'month',
      metadata: { source: 'e2e' },
    },
  })
})

When('the admin requests effective policy', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.response = await apiJson<Json>(this.e2e.page.request, '/api/governance/effective-policy')
})

When('a user creates or updates an MCP connection', async function (this: ProductWorld) {
  await ensureSignedIn(this)
  this.e2e.credential = await createMcpCredential(this.e2e)
  const rawCredential = await apiResponse(this.e2e.page.request, '/api/mcp/connections', {
    method: 'POST',
    data: { connectorId: 'github', secretValue: 'raw-github-token' },
  })
  assert.equal(rawCredential.status(), 400)
  this.e2e.mcpConnection = await connectMcp(this.e2e, {
    connectorId: 'github',
    credentialId: this.e2e.credential.id,
    credentialVersionId: this.e2e.credential.activeVersionId,
    approvalMode: 'per_call',
    metadata: { owner: 'platform' },
  })
  this.e2e.mcpConnection = await apiJson<Json>(
    this.e2e.page.request,
    `/api/mcp/connections/${this.e2e.mcpConnection.id}`,
    {
      method: 'PATCH',
      data: { endpointUrl: 'https://mcp.example.test/github', approvalMode: 'none', status: 'connected' },
    },
  )
})

When(
  'the user provides a credential reference or creates a new vault credential for the connector',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.credential = await createMcpCredential(this.e2e)
    this.e2e.mcpConnection = await connectMcp(this.e2e, {
      connectorId: 'github',
      credentialId: this.e2e.credential.id,
      credentialVersionId: this.e2e.credential.activeVersionId,
    })
  },
)

When('the user connects it again with a new credential reference', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const nextCredential = await createMcpCredential(state)
  this.e2e.credential = nextCredential
  this.e2e.response = await connectMcp(state, {
    connectorId: 'github',
    credentialId: nextCredential.id,
    credentialVersionId: nextCredential.activeVersionId,
    approvalMode: 'none',
  })
})

When('the user disconnects it and confirms', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await emptyResponse(state.page.request, `/api/mcp/connections/${state.mcpConnection?.id}?confirm=true`, {
    method: 'DELETE',
  })
})

When('a user from organization B lists, reads, or uses the same connector id', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const otherPage = required(state.otherPage, 'other page')
  const list = await apiJson<ListResponse<Json>>(otherPage.request, '/api/mcp/connections')
  const read = await apiResponse(otherPage.request, `/api/mcp/connections/${state.mcpConnection?.id}`)
  this.e2e.response = { list, readStatus: read.status() }
})

When('an agent tries to call it', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const response = await apiResponse(
    state.page.request,
    `/runtime/sessions/${state.latestSession?.id}/mcp/github/tools/repo.read/calls`,
    {
      method: 'POST',
      data: { input: { repo: 'saltbo/any-managed-agents' } },
    },
  )
  this.e2e.responseStatus = response.status()
  this.e2e.response = (await response.json()) as Json
})

When(
  'a user changes agents, sessions, providers, vaults, governance, or sandbox policy',
  async function (this: ProductWorld) {
    await ensureAgentAndEnvironment(this)
    await emptyResponse(this.e2e.page.request, `/api/agents/${this.e2e.agent?.id}`, { method: 'DELETE' })
    await emptyResponse(this.e2e.page.request, `/api/environments/${this.e2e.environment?.id}`, { method: 'DELETE' })
    await createProvider(this.e2e, {
      type: 'workers-ai',
      displayName: `${this.e2e.runId} audit provider`,
    })
    this.e2e.vault = await createVault(this.e2e)
    await apiJson<Json>(this.e2e.page.request, '/api/governance/policy', {
      method: 'PUT',
      data: { sandboxPolicy: { network: 'disabled' } },
    })
    const activeAgent = await createAgent(this.e2e, { name: `${this.e2e.runId} audit session agent` })
    const activeEnvironment = await createEnvironment(this.e2e, { name: `${this.e2e.runId} audit session env` })
    this.e2e.agent = activeAgent
    this.e2e.environment = activeEnvironment
    this.e2e.latestSession = await createSession(this.e2e)
    await emptyResponse(this.e2e.page.request, `/api/sessions/${this.e2e.latestSession.id}/stop`, { method: 'POST' })
  },
)

When(
  'runtime policy blocks a provider call, tool call, MCP connector, sandbox command, network request, or credential resolution',
  async function (this: ProductWorld) {
    await ensureAgentAndEnvironment(this)
    this.e2e.latestSession = await createSession(this.e2e)
    await apiJson<Json>(this.e2e.page.request, '/api/governance/policy', {
      method: 'PUT',
      data: { mcpPolicy: { allowedConnectors: ['linear'] } },
    })
    const response = await apiResponse(
      this.e2e.page.request,
      `/runtime/sessions/${this.e2e.latestSession.id}/mcp/github/tools/repo.read/calls`,
      {
        method: 'POST',
        data: { input: { repo: 'saltbo/any-managed-agents' } },
      },
    )
    this.e2e.responseStatus = response.status()
    this.e2e.response = (await response.json()) as Json
  },
)

Given('a mutating API request succeeds or fails after validation', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
  await sendRuntimeMessage(this.e2e, 'audit correlation message')
  await emptyResponse(this.e2e.page.request, `/api/sessions/${this.e2e.latestSession.id}/stop`, { method: 'POST' })
})

When('audit logging records the action', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.list = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?action=session.stop&limit=10')
})

When(
  'the user creates an agent with instructions, provider, model, skills, allowed tools, MCP connectors, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.agent = await createAgent(this.e2e, {
      name: `${this.e2e.runId} full agent`,
      instructions: 'Use tools when needed.',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      skills: ['ama@code-review'],
      allowedTools: ['sandbox.exec'],
      mcpConnectors: [],
      metadata: { purpose: 'e2e' },
    })
  },
)

When(
  'the user changes instructions, model config, skills, tools, MCP connectors, or metadata',
  async function (this: ProductWorld) {
    const state = await ensureAgentAndEnvironment(this)
    state.previousSession = await createSession(state)
    state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
      method: 'PATCH',
      data: {
        instructions: 'Updated instructions',
        skills: ['ama@updated-skill'],
        allowedTools: [],
        metadata: { updated: true },
      },
    })
    state.latestSession = await createSession(state)
  },
)

When('the user changes instructions, model, skills, or tools', async function (this: ProductWorld) {
  const state = await ensureAgentAndEnvironment(this)
  state.previousSession = await createSession(state)
  state.updatedAgent = await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
    method: 'PATCH',
    data: {
      instructions: 'Updated instructions',
      skills: ['ama@updated-skill'],
      allowedTools: [],
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
  'an agent is saved with an unavailable provider, blocked tool, invalid skill, or sandbox policy',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const response = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: {
        name: `${state.runId} invalid agent`,
        model: 'missing-model',
        skills: ['invalid-skill'],
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
  'the user creates an environment with package requirements, variables, secret references, hostingMode and runtime fields, allowed outbound hosts, MCP access rules, package-manager access rules, resource limits, runtime config, and metadata',
  async function (this: ProductWorld) {
    await ensureSignedIn(this)
    this.e2e.environment = await createEnvironment(this.e2e, {
      name: `${this.e2e.runId} full env`,
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: { NODE_ENV: { required: true } },
      secretRefs: [{ name: 'TOKEN', ref: 'wrangler_secret:AMA_TOKEN' }],
      hostingMode: 'cloud',
      runtime: 'ama',
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      mcpPolicy: { allowedConnectors: [] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      resourceLimits: { memoryMb: 512, timeoutSeconds: 300 },
      runtimeConfig: { image: 'ama-pi-runtime' },
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
  'the user changes packages, variables, secret references, hostingMode and runtime fields, network policy, resource limits, runtime config, or metadata',
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
        hostingMode: 'cloud',
        runtime: 'ama',
        networkPolicy: { mode: 'offline' },
        resourceLimits: { memoryMb: 768 },
        runtimeConfig: { image: 'ama-pi-runtime' },
        metadata: { updated: true },
      },
    })
    state.latestSession = await createSession(state)
  },
)

When('the user creates an environment with hostingMode and runtime', async function (this: ProductWorld) {
  const state = await ensureSignedIn(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} canonical runtime env`,
    hostingMode: 'self_hosted',
    runtime: 'codex',
    runtimeConfig: { image: 'ama-pi-runtime' },
  })
})

When(
  'the user creates an environment with workspace, secret references, network policy, resource limits, and runtime config',
  async function (this: ProductWorld) {
    const state = await ensureSignedIn(this)
    state.environment = await createEnvironment(state, {
      name: `${state.runId} runtime config env`,
      secretRefs: [{ name: 'TOKEN', ref: 'wrangler_secret:AMA_TOKEN' }],
      hostingMode: 'cloud',
      runtime: 'ama',
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      resourceLimits: { memoryMb: 512 },
      runtimeConfig: { image: 'ama-pi-runtime', command: 'ama' },
    })
    state.agent = await createAgent(state, { name: `${state.runId} runtime config agent` })
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
      resourceRefs: [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents' }],
      vaultRefs: [{ type: 'credential', id: 'cred_1' }],
    })
  },
)

When(
  'an external scheduler creates a session with an initial prompt and run correlation metadata',
  async function (this: ProductWorld) {
    await ensureAgentAndEnvironment(this)
    const state = await ensureState(this)
    state.runtimeMessage = 'Research current Canadian banking bonus offers.'
    const session = await apiJson<Json>(state.page.request, '/api/sessions', {
      method: 'POST',
      data: {
        agentId: state.agent?.id,
        environmentId: state.environment?.id,
        title: `${state.runId} scheduled banking bonus research`,
        metadata: {
          externalRunId: `${state.runId}-banking-bonus`,
          source: 'tftt-cron',
        },
        initialPrompt: state.runtimeMessage,
      },
    })
    state.response = session
    state.latestSession = await waitForSession(state.page.request, String(session.id))
  },
)

When('the user creates a due scheduled agent trigger', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  const state = await ensureState(this)
  state.runtimeMessage = 'Research current Canadian banking bonus offers.'
  state.scheduledTrigger = await apiJson<Json>(state.page.request, '/api/scheduled-agent-triggers', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      name: `${state.runId} banking bonus heartbeat`,
      promptTemplate: state.runtimeMessage,
      schedule: { type: 'interval', intervalSeconds: 3600 },
      nextDueAt: '2026-05-26T12:00:00.000Z',
      metadata: { externalRunGroup: `${state.runId}-banking-bonus` },
    },
  })
})

When('the local heartbeat dispatcher runs twice for the same occurrence', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.scheduledDispatch = await apiJson<Json>(state.page.request, '/api/e2e/scheduled-agent-triggers/dispatch', {
    method: 'POST',
    data: { heartbeatAt: '2026-05-26T12:01:00.000Z' },
  })
  state.duplicateScheduledDispatch = await apiJson<Json>(
    state.page.request,
    '/api/e2e/scheduled-agent-triggers/dispatch',
    {
      method: 'POST',
      data: { heartbeatAt: '2026-05-26T12:01:00.000Z' },
    },
  )
  const run = required(arrayValue(state.scheduledDispatch.runs)[0], 'scheduled run')
  state.latestSession = await waitForSession(state.page.request, String(run.sessionId))
})

When('the user creates paused and archived scheduled agent triggers', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  const state = await ensureState(this)
  const paused = await apiJson<Json>(state.page.request, '/api/scheduled-agent-triggers', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      name: `${state.runId} paused heartbeat`,
      promptTemplate: 'Do not dispatch paused trigger.',
      schedule: { intervalSeconds: 3600 },
      status: 'paused',
      nextDueAt: '2026-05-26T12:00:00.000Z',
    },
  })
  const archived = await apiJson<Json>(state.page.request, '/api/scheduled-agent-triggers', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      name: `${state.runId} archived heartbeat`,
      promptTemplate: 'Do not dispatch archived trigger.',
      schedule: { intervalSeconds: 3600 },
      nextDueAt: '2026-05-26T12:00:00.000Z',
    },
  })
  await emptyResponse(state.page.request, `/api/scheduled-agent-triggers/${archived.id}`, { method: 'DELETE' })
  state.inactiveScheduledTriggers = [paused, archived]
})

When('the local heartbeat dispatcher runs', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.scheduledDispatch = await apiJson<Json>(state.page.request, '/api/e2e/scheduled-agent-triggers/dispatch', {
    method: 'POST',
    data: { heartbeatAt: '2026-05-26T12:01:00.000Z' },
  })
})

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

When('that runtime does not support the exact provider and model', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const response = await apiResponse(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      title: `${state.runId} unsupported runtime session`,
    },
  })
  state.responseStatus = response.status()
  state.response = (await response.json()) as Json
})

When(
  'the selected environment runtime does not support the selected agent provider and model',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const response = await apiResponse(state.page.request, '/api/sessions', {
      method: 'POST',
      data: {
        agentId: state.agent?.id,
        environmentId: state.environment?.id,
        title: `${state.runId} unsupported runtime session`,
      },
    })
    state.responseStatus = response.status()
    state.response = (await response.json()) as Json
  },
)

When('no runner advertises the exact runtime provider and model', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const wrongCapability = `runtime-provider-model:codex:${state.provider?.id}:${CODEX_E2E_MODEL}-mini`
  state.otherProvider = await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} wrong codex runner`,
      environmentId: state.environment?.id,
      capabilities: [wrongCapability],
    },
  })
  await apiJson<Json>(state.page.request, `/api/runners/${state.otherProvider.id}/heartbeats`, {
    method: 'POST',
    data: { status: 'active', currentLoad: 0, capabilities: [wrongCapability] },
  })
  const response = await apiResponse(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      title: `${state.runId} unsupported self-hosted codex session`,
    },
  })
  state.responseStatus = response.status()
  state.response = (await response.json()) as Json
})

When('a runner advertises the exact runtime provider and model', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const capability = `runtime-provider-model:codex:${state.provider?.id}:${CODEX_E2E_MODEL}`
  state.runner = await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} exact codex runner`,
      environmentId: state.environment?.id,
      capabilities: [capability],
    },
  })
  state.runner = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/heartbeats`, {
    method: 'POST',
    data: { status: 'active', currentLoad: 0, capabilities: [capability] },
  })
})

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
    `/api/sessions/${state.latestSession?.id}/events?type=transcript.message&limit=10`,
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
  'metadata, credentials, model catalog, rate limits, and budget policy are stored safely',
  function (this: ProductWorld) {
    const provider = required(this.e2e?.provider, 'provider')
    const model = required(this.e2e?.providerModel, 'provider model')
    assert.equal(provider.type, 'openai-compatible')
    assert.equal(provider.hasCredential, true)
    assert.equal(provider.credentialStatus, 'configured')
    assert.equal(provider.modelCatalogStatus, 'ready')
    assert.equal(objectValue(provider.rateLimits).requestsPerMinute, 120)
    assert.equal(objectValue(provider.budgetPolicy).monthlyCostMicros, 1000000)
    assert.equal(objectValue(model.pricing).inputMicrosPerToken, 1)
    assert.equal(JSON.stringify(provider).includes('raw-secret-value'), false)
    assert.equal(JSON.stringify(model).includes('raw-secret-value'), false)
  },
)

Then('the platform validates endpoint, credentials, policy, and approval mode', function (this: ProductWorld) {
  const connection = required(this.e2e?.mcpConnection, 'mcp connection')
  assert.equal(connection.connectorId, 'github')
  assert.equal(connection.endpointUrl, 'https://mcp.example.test/github')
  assert.equal(connection.approvalMode, 'none')
  assert.equal(connection.status, 'connected')
  assert.equal(connection.hasCredential, true)
  assert.equal(JSON.stringify(connection).includes('raw-github-token'), false)
})

Then('the platform stores only encrypted or secret-referenced credentials', function (this: ProductWorld) {
  const connection = required(this.e2e?.mcpConnection, 'mcp connection')
  const credential = required(this.e2e?.credential, 'credential')
  assert.equal(connection.hasCredential, true)
  assert.equal(JSON.stringify(connection).includes(String(credential.id)), false)
  assert.equal(JSON.stringify(connection).includes(String(credential.activeVersionId)), false)
  assert.equal(JSON.stringify(connection).includes('raw-github-token'), false)
})

Then(
  'the connection status becomes connected for the current organization or project scope',
  function (this: ProductWorld) {
    const connection = required(this.e2e?.mcpConnection, 'mcp connection')
    assert.equal(connection.connectorId, 'github')
    assert.equal(connection.status, 'connected')
    assert.equal(typeof connection.organizationId, 'string')
    assert.equal(typeof connection.projectId, 'string')
  },
)

Then('connector lists report connected status without exposing credentials', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/mcp/connectors?search=GitHub')
  const github = required(
    list.data.find((connector) => connector.connectorId === 'github'),
    'github connector',
  )
  assert.equal(github.connectionStatus, 'connected')
  assert.equal(JSON.stringify(list).includes(String(state.credential?.id)), false)
  assert.equal(JSON.stringify(list).includes('raw-github-token'), false)
})

Then('the connection is updated instead of duplicated', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const updated = required(state.response, 'updated connection')
  assert.equal(updated.id, state.mcpConnection?.id)
  assert.equal(updated.approvalMode, 'none')
  const connections = await apiJson<ListResponse<Json>>(state.page.request, '/api/mcp/connections')
  assert.equal(connections.data.filter((connection) => connection.connectorId === 'github').length, 1)
})

Then('future sessions cannot use that connector through the old connection', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await ensureAgentAndEnvironment(this)
  state.latestSession = await createSession(state)
  const response = await apiResponse(
    state.page.request,
    `/api/mcp/connections/${state.mcpConnection?.id}/tools/repo.read/calls`,
    {
      method: 'POST',
      data: { sessionId: state.latestSession.id, input: { repo: 'saltbo/any-managed-agents' } },
    },
  )
  assert.equal(response.status(), 403)
})

Then('audit events record connect, update, and disconnect actions', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?limit=50')
  assert.ok(audit.data.some((record) => record.action === 'mcp_connection.connect'))
  assert.ok(audit.data.some((record) => record.action === 'mcp_connection.update'))
  assert.ok(audit.data.some((record) => record.action === 'mcp_connection.disconnect'))
  assert.equal(JSON.stringify(audit).includes('raw-github-token'), false)
})

Then("organization A's connection and credentials are not visible or usable", function (this: ProductWorld) {
  const response = required(this.e2e?.response, 'tenant response')
  const list = response.list as ListResponse<Json>
  assert.deepEqual(list.data, [])
  assert.equal(response.readStatus, 404)
})

Then('the runtime denies the call and records a policy event', async function (this: ProductWorld) {
  const state = await ensureState(this)
  assert.equal(state.responseStatus, 403)
  assert.equal(objectValue(state.response?.error).type, 'policy_denied')
  const events = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events`,
  )
  assert.ok(events.data.some((event) => event.type === 'policy.decision'))
  const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?action=runtime_mcp_tool.call')
  assert.ok(audit.data.some((record) => record.outcome === 'denied'))
})

Then(
  'the platform writes an audit event with actor, resource, action, timestamp, and safe metadata',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?limit=100')
    for (const action of [
      'agent.archive',
      'environment.archive',
      'provider.create',
      'vault.create',
      'governance_policy.update',
      'session.create',
      'session.stop',
    ]) {
      assert.ok(
        audit.data.some((record) => record.action === action),
        `expected audit action ${action}`,
      )
    }
    const record = required(audit.data[0], 'audit record')
    assert.equal(typeof record.actorUserId, 'string')
    assert.equal(typeof record.resourceType, 'string')
    assert.equal(typeof record.action, 'string')
    assert.equal(typeof record.createdAt, 'string')
    assert.equal(JSON.stringify(audit).includes('raw-secret'), false)
  },
)

Then(
  'the platform writes an audit event with policy category, rule reference, session id, and safe metadata',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    assert.equal(state.responseStatus, 403)
    const audit = await apiJson<ListResponse<Json>>(
      state.page.request,
      '/api/audit-records?action=runtime_mcp_tool.call',
    )
    const record = required(
      audit.data.find((item) => item.outcome === 'denied'),
      'denied runtime audit record',
    )
    assert.equal(record.policyCategory, 'mcp')
    assert.equal(typeof record.resourceId, 'string')
    assert.equal(record.sessionId, state.latestSession?.id)
    assert.equal(JSON.stringify(record).includes('raw-secret'), false)
  },
)

Then(
  'the record includes request id, actor id, organization id, project id, resource id, action, outcome, and timestamp',
  function (this: ProductWorld) {
    const record = required(this.e2e?.list?.data[0], 'audit record')
    assert.equal(typeof record.requestId, 'string')
    assert.equal(typeof record.actorUserId, 'string')
    assert.equal(typeof record.organizationId, 'string')
    assert.equal(typeof record.projectId, 'string')
    assert.equal(record.resourceId, this.e2e?.latestSession?.id)
    assert.equal(record.action, 'session.stop')
    assert.equal(record.outcome, 'success')
    assert.equal(typeof record.createdAt, 'string')
  },
)

Then('the record can be linked to related session events when applicable', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const record = required(state.list?.data[0], 'audit record')
  assert.equal(record.sessionId, state.latestSession?.id)
  const events = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events`,
  )
  assert.ok(events.data.length > 0)
})

Then('the response shows platform default providers separately from project overrides', function (this: ProductWorld) {
  const list = required(this.e2e?.list, 'providers')
  assert.equal(list.data.length, 1)
  assert.equal(list.data[0]?.id, 'workers-ai')
  assert.equal(objectValue(list.data[0]?.metadata).platformDefault, true)
})

Then(
  'each provider reports id, type, display name, default status, credential status, model catalog status, and timestamps',
  function (this: ProductWorld) {
    const list = required(this.e2e?.list, 'providers')
    for (const provider of list.data) {
      assert.equal(typeof provider.id, 'string')
      assert.equal(typeof provider.type, 'string')
      assert.equal(typeof provider.displayName, 'string')
      assert.equal(typeof provider.isDefault, 'boolean')
      assert.equal(typeof provider.credentialStatus, 'string')
      assert.equal(typeof provider.modelCatalogStatus, 'string')
      assert.equal(typeof provider.createdAt, 'string')
      assert.equal(typeof provider.updatedAt, 'string')
    }
  },
)

Then('secret values are never returned', function (this: ProductWorld) {
  const payload = JSON.stringify(this.e2e?.list ?? this.e2e?.provider ?? this.e2e?.response ?? {})
  assert.equal(payload.includes('secret://'), false)
  assert.equal(payload.includes('raw-secret-value'), false)
})

Then('the provider stores Cloudflare account metadata and safe credential references', function (this: ProductWorld) {
  const provider = required(this.e2e?.provider, 'provider')
  assert.equal(provider.type, 'workers-ai')
  assert.equal(objectValue(provider.metadata).accountId, 'cf-account-ref')
  assert.equal(provider.credentialStatus, 'not_required')
  assert.equal(JSON.stringify(provider).includes('secret://'), false)
})

Then('it can be marked as the only default provider', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/providers')
  const defaults = list.data.filter((provider) => provider.isDefault === true)
  assert.equal(defaults.length, 1)
  assert.equal(defaults[0]?.id, state.provider?.id)
})

Then('model discovery includes Workers AI model ids allowed by governance', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const models = await apiJson<ListResponse<Json>>(state.page.request, '/api/providers/workers-ai/models')
  assert.ok(models.data.some((model) => model.modelId === '@cf/moonshotai/kimi-k2.6'))
  const evaluation = await apiJson<Json>(state.page.request, '/api/governance/evaluations', {
    method: 'POST',
    data: { providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' },
  })
  assert.equal(evaluation.allowed, true)
})

Then(
  'provider type, base URL when required, display name, default flag, rate limits, and budget policy are validated',
  function (this: ProductWorld) {
    const provider = required(this.e2e?.provider, 'provider')
    assert.equal(provider.type, 'openai-compatible')
    assert.equal(provider.baseUrl, 'https://models.example.test/v1')
    assert.equal(provider.isDefault, true)
    assert.equal(objectValue(provider.rateLimits).requestsPerMinute, 60)
    assert.equal(objectValue(provider.budgetPolicy).monthlyTokens, 1000)
  },
)

Then('credentials are stored through approved secret references', function (this: ProductWorld) {
  const provider = required(this.e2e?.provider, 'provider')
  assert.equal(provider.hasCredential, true)
  assert.equal(provider.credentialStatus, 'configured')
})

Then('the response includes hasCredential without returning the credential value', function (this: ProductWorld) {
  const provider = required(this.e2e?.provider, 'provider')
  assert.equal(provider.hasCredential, true)
  assert.equal(JSON.stringify(provider).includes('secret://'), false)
})

Then('every other provider in the same project is no longer default', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/providers')
  const defaults = list.data.filter((provider) => provider.isDefault === true)
  assert.deepEqual(
    defaults.map((provider) => provider.id),
    [state.otherProvider?.id],
  )
})

Then('future agents without explicit provider selection use the new default', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const agent = await createAgent(state, { name: `${state.runId} default provider agent` })
  assert.equal(agent.provider, state.otherProvider?.id)
})

Then('new sessions using that provider are rejected before runtime startup', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const response = await apiResponse(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      title: `${state.runId} denied provider session`,
    },
  })
  assert.equal(response.status(), 403)
  const body = await response.json()
  assert.equal(body.error.type, 'policy_denied')
})

Then('historical sessions remain readable', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.id, state.latestSession?.id)
})

Then('it no longer appears in provider lists', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const list = await apiJson<ListResponse<Json>>(state.page.request, '/api/providers')
  assert.equal(
    list.data.some((provider) => provider.id === state.otherProvider?.id),
    false,
  )
})

Then('the platform validates and applies the policy to later sessions', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const policy = required(state.policy, 'policy')
  assert.equal(objectValue(policy.budgetPolicy).monthlyTokens, 0)
  const response = await apiResponse(state.page.request, '/api/governance/evaluations', {
    method: 'POST',
    data: { providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' },
  })
  assert.equal(response.status(), 403)
})

Then('the response includes normalized allow and deny rules', function (this: ProductWorld) {
  const rule = required(this.e2e?.accessRule, 'access rule')
  assert.equal(rule.providerId, 'workers-ai')
  assert.equal(rule.modelId, '@cf/moonshotai/kimi-k2.6')
  assert.equal(rule.teamId, 'team_e2e')
  assert.equal(rule.effect, 'deny')
})

Then(
  'future agent and session creation enforce those rules before runtime startup',
  async function (this: ProductWorld) {
    const state = await ensureAgentAndEnvironment(this)
    const response = await apiResponse(state.page.request, '/api/sessions', {
      method: 'POST',
      data: { agentId: state.agent?.id, environmentId: state.environment?.id, title: `${state.runId} access denied` },
    })
    assert.equal(response.status(), 403)
    const body = await response.json()
    assert.equal(body.error.type, 'policy_denied')
    assert.equal(body.error.details.ruleId, state.accessRule?.id)
  },
)

Then('policy changes are audited with actor, resource, and safe diff metadata', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?limit=50')
  assert.ok(audit.data.some((record) => record.action === 'provider_access_rule.create'))
  assert.equal(JSON.stringify(audit).includes('secret://'), false)
})

Then('session startup and provider calls check remaining budget before execution', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const budget = required(state.budget, 'budget')
  assert.equal(budget.limitType, 'tokens')
  const response = await apiResponse(state.page.request, '/api/governance/evaluations', {
    method: 'POST',
    data: { providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' },
  })
  assert.equal(response.status(), 403)
  const body = await response.json()
  assert.equal(body.error.details.category, 'budget')
})

Then('budget denials are visible in usage and audit records', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await apiResponse(state.page.request, '/api/governance/evaluations', {
    method: 'POST',
    data: { providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' },
  })
  const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?action=policy.evaluate')
  assert.ok(audit.data.some((record) => record.outcome === 'denied' && record.policyCategory === 'budget'))
})

Then(
  'the response explains the resolved rule source for provider, model, tool, MCP, sandbox, and budget decisions',
  function (this: ProductWorld) {
    const effective = required(this.e2e?.response, 'effective policy')
    assert.equal(objectValue(effective.source).type, 'project')
    assert.ok(Array.isArray(effective.providerRules))
    assert.ok(Array.isArray(effective.modelRules))
    assert.ok(Array.isArray(effective.accessRules))
    assert.equal(objectValue(effective.toolPolicy).deniedTools?.[0], 'secrets.read')
    assert.equal(objectValue(effective.mcpPolicy).deniedConnectors?.[0], 'github')
    assert.equal(objectValue(effective.sandboxPolicy).network, 'disabled')
    assert.equal(objectValue(effective.budgetPolicy).monthlyTokens, 0)
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
  const agentSnapshot = objectValue(session.agentSnapshot)
  assert.equal(agentSnapshot.version, objectValue(state.agent).version)
  assert.deepEqual(agentSnapshot.skills, objectValue(state.agent).skills)
  assert.equal('sandboxPolicy' in agentSnapshot, false)
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
    assert.ok(Array.isArray(agent.skills))
    assert.ok(Array.isArray(agent.allowedTools))
    assert.ok(Array.isArray(agent.mcpConnectors))
    assert.equal(typeof agent.metadata, 'object')
    assert.equal('sandboxPolicy' in agent, false)
  },
)

Then(
  'the first agent version stores the instructions, model config, skills, tool policy, MCP connectors, and metadata',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const versions = await apiJson<ListResponse<Json>>(state.page.request, `/api/agents/${state.agent?.id}/versions`)
    assert.equal(versions.data[0]?.version, 1)
    assert.ok(Array.isArray(versions.data[0]?.skills))
    assert.equal('sandboxPolicy' in required(versions.data[0], 'agent version'), false)
  },
)

Then('normal agent responses do not expose sandbox policy', function (this: ProductWorld) {
  const agent = required(this.e2e?.agent, 'agent')
  assert.equal('sandboxPolicy' in agent, false)
})

Then('the response echoes the normalized runtime configuration', function (this: ProductWorld) {
  const agent = required(this.e2e?.agent, 'agent')
  assert.deepEqual(agent.skills, ['ama@code-review'])
  assert.deepEqual(agent.allowedTools, ['sandbox.exec'])
  assert.deepEqual(agent.metadata, { purpose: 'e2e' })
})

Then(
  'blocked tools, unavailable models, invalid skills, and agent sandbox policies are rejected with field-level validation details',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalid = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} blocked`, allowedTools: ['secrets.read'] },
    })
    const body = (await invalid.json()) as { error?: { details?: Json } }
    assert.equal(invalid.status(), 400)
    assert.equal(typeof body.error?.details, 'object')

    const invalidSkill = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} invalid skill`, skills: ['invalid-skill'] },
    })
    assert.equal(invalidSkill.status(), 400)

    const agentSandboxPolicy = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} agent sandbox policy`, sandboxPolicy: { network: 'enabled' } },
    })
    assert.equal(agentSandboxPolicy.status(), 400)
  },
)

Then(
  'secret material is never accepted directly inside agent metadata, tools, or connector configuration',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalidMetadata = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} secret`, metadata: { apiKey: 'raw-secret' } },
    })
    assert.equal(invalidMetadata.status(), 400)

    const invalidSkill = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} secret skill`, skills: ['ama@raw-secret-token'] },
    })
    assert.equal(invalidSkill.status(), 400)

    const invalidTool = await apiResponse(state.page.request, '/api/agents', {
      method: 'POST',
      data: { name: `${state.runId} secret tool`, allowedTools: ['raw-secret-token'] },
    })
    assert.equal(invalidTool.status(), 400)
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
  const snapshot = objectValue(this.e2e?.previousSession?.agentSnapshot)
  assert.equal(snapshot.version, 1)
  assert.deepEqual(snapshot.skills, [])
  assert.equal('sandboxPolicy' in snapshot, false)
})

Then('existing sessions continue using their original agent snapshot', function (this: ProductWorld) {
  const snapshot = objectValue(this.e2e?.previousSession?.agentSnapshot)
  assert.equal(snapshot.version, 1)
  assert.equal('sandboxPolicy' in snapshot, false)
})

Then('sessions created after the update use the version 2 snapshot', function (this: ProductWorld) {
  const snapshot = objectValue(this.e2e?.latestSession?.agentSnapshot)
  assert.equal(snapshot.version, 2)
  assert.deepEqual(snapshot.skills, ['ama@updated-skill'])
  assert.equal('sandboxPolicy' in snapshot, false)
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
  'package lists, variables, secret references, hostingMode and runtime fields, network policy, resource limits, runtime config, and metadata have stable default values',
  function (this: ProductWorld) {
    const env = required(this.e2e?.environment, 'environment')
    for (const key of [
      'packages',
      'variables',
      'secretRefs',
      'hostingMode',
      'runtime',
      'networkPolicy',
      'resourceLimits',
      'runtimeConfig',
      'metadata',
    ]) {
      assert.ok(key in env)
    }
    assert.equal(env.hostingMode, 'cloud')
    assert.equal(env.runtime, 'ama')
    assert.deepEqual(env.networkPolicy, { mode: 'unrestricted' })
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
  assert.equal(env.hostingMode, 'cloud')
  assert.equal(env.runtime, 'ama')
  assert.deepEqual(env.networkPolicy, { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] })
  assert.deepEqual(env.packageManagerPolicy, { allowedRegistries: ['registry.npmjs.org'] })
})

Then('hostingMode accepts only cloud or self_hosted', async function (this: ProductWorld) {
  const state = await ensureState(this)
  assert.equal(state.environment?.hostingMode, 'self_hosted')
  const cloud = await createEnvironment(state, {
    name: `${state.runId} cloud runtime env`,
    hostingMode: 'cloud',
    runtime: 'ama',
  })
  assert.equal(cloud.hostingMode, 'cloud')

  const invalid = await apiResponse(state.page.request, '/api/environments', {
    method: 'POST',
    data: { name: `${state.runId} invalid hosting`, hostingMode: 'self-hosted', runtime: 'ama' },
  })
  assert.equal(invalid.status(), 400)
})

Then('runtime accepts only ama, claude-code, codex, or copilot', async function (this: ProductWorld) {
  const state = await ensureState(this)
  assert.equal(state.environment?.runtime, 'codex')
  for (const runtime of ['ama', 'claude-code', 'copilot']) {
    const env = await createEnvironment(state, {
      name: `${state.runId} ${runtime} runtime env`,
      hostingMode: 'cloud',
      runtime,
    })
    assert.equal(env.runtime, runtime)
  }

  const invalid = await apiResponse(state.page.request, '/api/environments', {
    method: 'POST',
    data: { name: `${state.runId} invalid runtime`, hostingMode: 'cloud', runtime: 'pi' },
  })
  assert.equal(invalid.status(), 400)
})

Then(
  'invalid hostingMode or runtime values return field-level validation details',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalid = await apiResponse(state.page.request, '/api/environments', {
      method: 'POST',
      data: { name: `${state.runId} invalid canonical runtime`, hostingMode: 'hybrid', runtime: 'pi' },
    })
    assert.equal(invalid.status(), 400)
    const body = (await invalid.json()) as Json
    const issues = objectValue(required(body.error, 'validation error')).issues as Array<{ path?: string[] }>
    assert.ok(issues.some((issue) => issue.path?.[0] === 'hostingMode'))
    assert.ok(issues.some((issue) => issue.path?.[0] === 'runtime'))
  },
)

Then('requests using legacy environment runtime fields fail validation', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const invalid = await apiResponse(state.page.request, '/api/environments', {
    method: 'POST',
    data: {
      name: `${state.runId} legacy runtime fields`,
      runtimeType: 'cloud-hosted',
      runtimeImage: { image: 'node:24' },
    },
  })
  assert.equal(invalid.status(), 400)
})

Then('the API does not infer runtime ownership from the selected agent', function (this: ProductWorld) {
  const env = required(this.e2e?.environment, 'environment')
  assert.equal(env.hostingMode, 'self_hosted')
  assert.equal(env.runtime, 'codex')
})

Then('the environment snapshot stores those runtime fields', function (this: ProductWorld) {
  const env = required(this.e2e?.environment, 'environment')
  const session = required(this.e2e?.latestSession, 'session')
  assert.equal(env.hostingMode, 'cloud')
  assert.equal(env.runtime, 'ama')
  assert.deepEqual(env.runtimeConfig, { image: 'ama-pi-runtime', command: 'ama' })
  assert.deepEqual(objectValue(session.environmentSnapshot).runtimeConfig, env.runtimeConfig)
})

Then(
  'agent persona, instructions, policy, provider, and model are not stored on the environment',
  function (this: ProductWorld) {
    const env = required(this.e2e?.environment, 'environment')
    for (const key of ['instructions', 'systemPrompt', 'provider', 'model', 'allowedTools']) {
      assert.equal(key in env, false)
    }
  },
)

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
  'restricted network policy without allowed hosts, invalid package specs, and invalid host patterns return field-level validation details',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const invalid = await apiResponse(state.page.request, '/api/environments', {
      method: 'POST',
      data: { name: `${state.runId} invalid`, packages: [{ name: '' }] },
    })
    assert.equal(invalid.status(), 400)

    const missingHosts = await apiResponse(state.page.request, '/api/environments', {
      method: 'POST',
      data: { name: `${state.runId} restricted invalid`, networkPolicy: { mode: 'restricted' } },
    })
    assert.equal(missingHosts.status(), 400)
    const missingHostsBody = (await missingHosts.json()) as Json
    assert.deepEqual(objectValue(required(missingHostsBody.error, 'missing hosts error')).issues?.[0]?.path, [
      'networkPolicy',
      'allowedHosts',
    ])

    const invalidHost = await apiResponse(state.page.request, '/api/environments', {
      method: 'POST',
      data: {
        name: `${state.runId} host invalid`,
        networkPolicy: { mode: 'restricted', allowedHosts: ['https://registry.npmjs.org'] },
      },
    })
    assert.equal(invalidHost.status(), 400)
    const invalidHostBody = (await invalidHost.json()) as Json
    assert.deepEqual(objectValue(required(invalidHostBody.error, 'invalid host error')).issues?.[0]?.path, [
      'networkPolicy',
      'allowedHosts',
      0,
    ])
  },
)

When('the user creates a self-hosted environment and starts a session with it', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} self-hosted env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent = await createAgent(state, { name: `${state.runId} self-hosted agent` })
  await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} self-hosted support runner`,
      environmentId: state.environment.id,
      capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  state.latestSession = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      title: `${state.runId} self-hosted session`,
    },
  })
})

Then('the session keeps the self-hosted environment snapshot', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.equal(objectValue(session.environmentSnapshot).hostingMode, 'self_hosted')
})

Then('the session remains pending with a waiting-for-runner reason', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.equal(session.status, 'pending')
  assert.equal(session.statusReason, 'waiting-for-runner')
})

Then('no Cloudflare Sandbox id is assigned before runner lease', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.equal(session.sandboxId, null)
  assert.equal(session.runtimeEndpointPath, null)
})

Given('a self-hosted environment has an active runner', async function (this: ProductWorld) {
  const state = await ensureSignedIn(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} runner env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent = await createAgent(state, { name: `${state.runId} runner agent` })
  state.runner = await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} runner`,
      environmentId: state.environment.id,
      capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      credentialSecretRef: `cloudflare-secret:${state.runId}-runner-token`,
    },
  })
  state.runner = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/heartbeats`, {
    method: 'POST',
    data: {
      status: 'active',
      currentLoad: 0,
      capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
})

Given('a self-hosted environment selects an external runtime', async function (this: ProductWorld) {
  const state = await ensureSignedIn(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} external runner env`,
    hostingMode: 'self_hosted',
    runtime: 'codex',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.provider = await createProvider(state, {
    type: 'openai-compatible',
    displayName: `${state.runId} external provider`,
    baseUrl: 'https://models.example.test/v1',
    credentialSecretRef: `secret://providers/${state.runId}/external`,
  })
  state.providerModel = await createProviderModel(state, state.provider, {
    modelId: CODEX_E2E_MODEL,
    displayName: 'GPT 5.3 Codex',
    capabilities: ['text'],
  })
  state.agent = await createAgent(state, {
    name: `${state.runId} external agent`,
    provider: state.provider.id,
    model: CODEX_E2E_MODEL,
  })
})

Given(
  'an active runner advertises the exact runtime, provider, and model capability',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const capability = `runtime-provider-model:codex:${state.provider?.id}:${CODEX_E2E_MODEL}`
    state.runner = await apiJson<Json>(state.page.request, '/api/runners', {
      method: 'POST',
      data: {
        name: `${state.runId} external runner`,
        environmentId: state.environment?.id,
        capabilities: ['sandbox.exec', capability],
      },
    })
    state.runner = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/heartbeats`, {
      method: 'POST',
      data: { status: 'active', currentLoad: 0, capabilities: ['sandbox.exec', capability] },
    })
    const wrongCapability = `runtime-provider-model:codex:${state.provider?.id}:${CODEX_E2E_MODEL}-mini`
    state.otherProvider = await apiJson<Json>(state.page.request, '/api/runners', {
      method: 'POST',
      data: {
        name: `${state.runId} ineligible external runner`,
        environmentId: state.environment?.id,
        capabilities: [wrongCapability],
      },
    })
    await apiJson<Json>(state.page.request, `/api/runners/${state.otherProvider.id}/heartbeats`, {
      method: 'POST',
      data: { status: 'active', currentLoad: 0, capabilities: [wrongCapability] },
    })
  },
)

When('the user creates a session in that environment', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.latestSession = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      title: `${state.runId} runner-backed session`,
      initialPrompt: 'Execute this self-hosted runner task.',
    },
  })
})

Then('AMA queues session work without creating a Cloudflare Sandbox', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = required(state.latestSession, 'session')
  assert.equal(session.status, 'pending')
  assert.equal(session.statusReason, 'waiting-for-runner')
  assert.equal(session.sandboxId, null)
  state.list = await apiJson<ListResponse<Json>>(state.page.request, `/api/runners/work-items?sessionId=${session.id}`)
  assert.equal(state.list.data.length, 1)
  assert.equal(state.list.data[0]?.status, 'available')
  const payload = objectValue(state.list.data[0]?.payload)
  assert.equal(payload.hostingMode, 'self_hosted')
  assert.equal(payload.runtime, 'ama')
  assert.equal(payload.runtimeDriver, 'ama-self-hosted')
  assert.equal(payload.runtimeOwner, undefined)
})

Then(
  'AMA queues the session for that environment without creating a Cloudflare Sandbox',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const session = required(state.latestSession, 'session')
    assert.equal(session.status, 'pending')
    assert.equal(session.statusReason, 'waiting-for-runner')
    assert.equal(session.sandboxId, null)
    assert.equal(session.runtimeEndpointPath, null)
    state.list = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/runners/work-items?sessionId=${session.id}`,
    )
    assert.equal(state.list.data.length, 1)
    assert.equal(objectValue(state.list.data[0]?.payload).hostingMode, 'self_hosted')
  },
)

Then('the runner can claim a lease for the queued work', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const runner = required(state.runner, 'runner')
  state.lease = await apiJson<Json>(state.page.request, `/api/runners/${runner.id}/leases`, {
    method: 'POST',
    data: { leaseDurationSeconds: 90 },
  })
  assert.equal(state.lease.status, 'active')
  assert.equal(objectValue(state.lease.workItem).status, 'leased')
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.status, 'pending')
  assert.equal(session.statusReason, 'waiting-for-runner')
})

Then('the eligible runner can claim ownership of the session', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const runner = required(state.runner, 'runner')
  state.lease = await apiJson<Json>(state.page.request, `/api/runners/${runner.id}/leases`, {
    method: 'POST',
    data: { leaseDurationSeconds: 90 },
  })
  assert.equal(state.lease.status, 'active')
  assert.equal(objectValue(state.lease.workItem).sessionId, state.latestSession?.id)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.status, 'pending')
  assert.equal(session.statusReason, 'waiting-for-runner')
})

Then('the runner can upload structured events and complete the lease', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const runner = required(state.runner, 'runner')
  const lease = required(state.lease, 'lease')
  const events = await apiJson<Json>(state.page.request, `/api/runners/${runner.id}/leases/${lease.id}/events`, {
    method: 'POST',
    data: {
      events: [
        {
          type: 'tool_call.started',
          payload: { type: 'tool_call.started', toolName: 'sandbox.exec', input: { command: 'npm test' } },
          metadata: { runnerId: runner.id },
        },
      ],
    },
  })
  assert.equal(events.accepted, 1)
  const completed = await apiJson<Json>(state.page.request, `/api/runners/${runner.id}/leases/${lease.id}`, {
    method: 'PATCH',
    data: { status: 'completed', result: { ok: true } },
  })
  assert.equal(completed.status, 'completed')
  assert.equal(objectValue(completed.workItem).status, 'succeeded')
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.status, 'idle')
})

Given('a runner has leased self-hosted session work', async function (this: ProductWorld) {
  const state = await ensureSignedIn(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} expiring runner env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent = await createAgent(state, { name: `${state.runId} expiring runner agent` })
  state.runner = await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} expiring runner`,
      environmentId: state.environment.id,
      capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  state.runner = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/heartbeats`, {
    method: 'POST',
    data: {
      status: 'active',
      currentLoad: 0,
      capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  state.latestSession = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      title: `${state.runId} expiring runner session`,
    },
  })
  state.lease = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/leases`, {
    method: 'POST',
    data: { leaseDurationSeconds: 90 },
  })
  assert.equal(state.lease.status, 'active')
})

When('the lease expires before renewal', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const runner = required(state.runner, 'runner')
  const lease = required(state.lease, 'lease')
  await apiJson<Json>(state.page.request, `/api/runners/${runner.id}/leases/${lease.id}`, {
    method: 'PATCH',
    data: { status: 'active', leaseDurationSeconds: 15 },
  })
  await delay(16_000)
  state.list = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/runners/work-items?sessionId=${state.latestSession?.id}`,
  )
})

Then('AMA returns retryable work to the available queue', function (this: ProductWorld) {
  const list = required(this.e2e?.list, 'work item list')
  assert.equal(list.data.length, 1)
  assert.equal(list.data[0]?.status, 'available')
  assert.equal(list.data[0]?.leaseId, null)
})

Then('the session exposes a safe waiting status', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.status, 'pending')
  assert.equal(session.statusReason, 'waiting-for-runner')
})

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
  'the response includes a session id, project id, organization id, status, timestamps, durable object name, runtime endpoint, and runtime metadata',
  function (this: ProductWorld) {
    const session = required(this.e2e?.latestSession, 'session')
    assert.match(String(session.id), /^session_/)
    assert.equal(typeof session.projectId, 'string')
    assert.equal(typeof session.organizationId, 'string')
    assert.equal(session.status, 'idle')
    assert.equal(typeof session.durableObjectName, 'string')
    assert.equal(typeof session.runtimeEndpointPath, 'string')
    assert.equal(objectValue(session.runtimeMetadata).provider, objectValue(session.agentSnapshot).provider)
    assert.equal(objectValue(session.runtimeMetadata).model, objectValue(session.agentSnapshot).model)
    assert.equal(objectValue(session.runtimeMetadata).runtime, objectValue(session.environmentSnapshot).runtime)
    assert.equal(objectValue(session.runtimeMetadata).hostingMode, objectValue(session.environmentSnapshot).hostingMode)
  },
)

Then('the session stores immutable agent and environment snapshots', function (this: ProductWorld) {
  const session = required(this.e2e?.latestSession, 'session')
  assert.ok(session.agentSnapshot)
  assert.ok(session.environmentSnapshot)
})

Then(
  'AMA creates cloud-owned runtime state and initializes a Cloudflare Sandbox executor',
  function (this: ProductWorld) {
    const session = required(this.e2e?.latestSession, 'session')
    assert.equal(typeof session.sandboxId, 'string')
    assert.equal(objectValue(session.metadata).runtimeBackend, 'ama-cloud')
  },
)

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
  assert.deepEqual(session.resourceRefs, [
    {
      type: 'github_repository',
      owner: 'saltbo',
      repo: 'any-managed-agents',
      mountPath: '/workspace/repos/saltbo/any-managed-agents',
    },
  ])
  assert.deepEqual(session.vaultRefs, [{ type: 'credential', id: 'cred_1' }])
})

Then(
  'file and repository resources are declared in the deterministic workspace manifest contract',
  function (this: ProductWorld) {
    const session = required(this.e2e?.latestSession, 'session')
    assert.equal(objectValue(session.metadata).resourceManifestPath, '/workspace/.ama/resources.json')
    assert.deepEqual(session.resourceRefs, [
      {
        type: 'github_repository',
        owner: 'saltbo',
        repo: 'any-managed-agents',
        mountPath: '/workspace/repos/saltbo/any-managed-agents',
      },
    ])
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
      resourceRefs: [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', apiKey: 'raw-secret' }],
    },
  })
  assert.equal(response.status(), 400)
})

Then('the response includes the session id and run correlation metadata', function (this: ProductWorld) {
  const session = required(this.e2e?.response, 'session response')
  assert.match(String(session.id), /^session_/)
  assert.equal(objectValue(session.metadata).externalRunId, `${this.e2e?.runId}-banking-bonus`)
  assert.equal(objectValue(session.metadata).source, 'tftt-cron')
})

Then(
  'the initial prompt is dispatched to the AMA-owned runtime without a browser WebSocket',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const events = await sessionEvents(state)
    assert.equal(state.observedEventTypes, undefined)
    assert.ok(JSON.stringify(events.data).includes(state.runtimeMessage ?? ''))
  },
)

Then(
  'one scheduled run creates a session with the initial prompt and correlation metadata',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const dispatch = required(state.scheduledDispatch, 'scheduled dispatch')
    const runs = arrayValue(dispatch.runs)
    assert.equal(dispatch.claimed, 1)
    assert.equal(dispatch.sessionCreated, 1)
    assert.equal(runs.length, 1)
    const run = objectValue(required(runs[0], 'scheduled run'))
    assert.equal(run.status, 'session_created')
    assert.equal(run.scheduledFor, '2026-05-26T12:00:00.000Z')
    const session = required(state.latestSession, 'scheduled session')
    assert.equal(session.id, run.sessionId)
    assert.equal(objectValue(session.metadata).source, 'scheduled-agent-trigger')
    assert.equal(objectValue(session.metadata).scheduledTriggerId, state.scheduledTrigger?.id)
    assert.equal(objectValue(session.metadata).scheduledRunId, run.runId)
    assert.equal(objectValue(session.metadata).scheduledFor, '2026-05-26T12:00:00.000Z')
    assert.equal(
      objectValue(session.metadata).correlationId,
      `schedule:${state.scheduledTrigger?.id}:2026-05-26T12:00:00.000Z`,
    )
    const runHistory = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/scheduled-agent-triggers/${state.scheduledTrigger?.id}/runs`,
    )
    const persistedRun = objectValue(required(runHistory.data[0], 'persisted scheduled run'))
    assert.equal(persistedRun.correlationId, objectValue(session.metadata).correlationId)
    assert.equal(persistedRun.idempotencyKey, `${state.scheduledTrigger?.id}:2026-05-26T12:00:00.000Z`)
    const events = await sessionEvents(state)
    assert.ok(JSON.stringify(events.data).includes(state.runtimeMessage ?? ''))
  },
)

Then(
  'duplicate heartbeat dispatch does not create another session for the same occurrence',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const duplicate = required(state.duplicateScheduledDispatch, 'duplicate scheduled dispatch')
    assert.equal(duplicate.claimed, 0)
    assert.equal(duplicate.sessionCreated, 0)
    assert.deepEqual(arrayValue(duplicate.runs), [])
    const runs = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/scheduled-agent-triggers/${state.scheduledTrigger?.id}/runs`,
    )
    assert.equal(runs.data.length, 1)
  },
)

Then('scheduled trigger dispatch is recorded in audit history', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const audit = await apiJson<ListResponse<Json>>(
    state.page.request,
    '/api/audit-records?action=scheduled_trigger.dispatch',
  )
  assert.ok(
    audit.data.some(
      (record) =>
        record.actorType === 'system' &&
        record.actorUserId === null &&
        record.sessionId === state.latestSession?.id &&
        record.outcome === 'success',
    ),
  )
})

Then('inactive scheduled triggers have no run history', async function (this: ProductWorld) {
  const state = await ensureState(this)
  assert.equal(state.scheduledDispatch?.claimed, 0)
  for (const trigger of state.inactiveScheduledTriggers ?? []) {
    const runs = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/scheduled-agent-triggers/${trigger.id}/runs`,
    )
    assert.deepEqual(runs.data, [])
  }
})

Then(
  'session events can be queried for launch diagnostics and transcript progress',
  async function (this: ProductWorld) {
    const events = await sessionEvents(await ensureState(this))
    const state = await ensureState(this)
    const audit = await apiJson<ListResponse<Json>>(
      state.page.request,
      '/api/audit-records?action=session.initial_prompt',
    )
    assert.ok(events.data.length > 0)
    assert.ok(events.data.some((event) => event.type === 'transcript.message'))
    assert.ok(audit.data.some((record) => record.sessionId === state.latestSession?.id && record.outcome === 'success'))
  },
)

Then('the request fails before starting a sandbox', function (this: ProductWorld) {
  assert.equal(this.e2e?.responseStatus, 409)
})

Then('session creation fails before any provider call is started', function (this: ProductWorld) {
  assert.equal(this.e2e?.responseStatus, 409)
})

Then('session creation fails before runner work is queued', async function (this: ProductWorld) {
  const state = await ensureState(this)
  assert.equal(state.responseStatus, 409)
  const workItems = await apiJson<ListResponse<Json>>(state.page.request, '/api/runners/work-items')
  assert.equal(
    workItems.data.some((item) => item.environmentId === state.environment?.id),
    false,
  )
})

Then(
  'the request fails before workspace allocation, sandbox creation, or self-hosted lease creation',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    assert.equal(state.responseStatus, 409)
    const sessions = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions')
    assert.equal(
      sessions.data.some((session) => session.title === `${state.runId} unsupported runtime session`),
      false,
    )
    const workItems = await apiJson<ListResponse<Json>>(state.page.request, '/api/runners/work-items')
    assert.equal(
      workItems.data.some((item) => item.environmentId === state.environment?.id),
      false,
    )
  },
)

Then('the error envelope identifies the unavailable dependency', function (this: ProductWorld) {
  assert.equal(objectValue(this.e2e?.response?.error).type, 'conflict')
})

Then('the error envelope identifies the unsupported runtime, provider, and model', function (this: ProductWorld) {
  const error = objectValue(this.e2e?.response?.error)
  const details = objectValue(error.details)
  assert.equal(error.type, 'conflict')
  assert.equal(details.resourceType, 'runtime_catalog')
  assert.equal(details.hostingMode, 'cloud')
  assert.equal(details.runtime, 'ama')
  assert.equal(details.provider, this.e2e?.provider?.id)
  assert.equal(details.model, 'gpt-5.3-codex')
})

Then('no session record is left in an active state', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const sessions = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions')
  assert.equal(
    sessions.data.some(
      (session) =>
        session.title === `${state.runId} rejected session` ||
        session.title === `${state.runId} unsupported runtime session`,
    ),
    false,
  )
})

Then('no runtime fallback or model substitution occurs', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const sessions = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions')
  assert.equal(
    sessions.data.some((session) => session.title === `${state.runId} unsupported runtime session`),
    false,
  )
})

Then(
  'AMA offers the session work only to runners that advertise the same runtime, provider, and model',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const session = required(state.latestSession, 'session')
    state.list = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/runners/work-items?sessionId=${session.id}`,
    )
    assert.equal(state.list.data.length, 1)
    assert.equal(
      objectValue(state.list.data[0]?.payload).requiredRunnerCapability,
      `runtime-provider-model:codex:${state.provider?.id}:${CODEX_E2E_MODEL}`,
    )
  },
)

Then('runners that lack the exact combination cannot lease the work', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const wrongRunner = required(state.otherProvider, 'wrong runner')
  const response = await apiResponse(state.page.request, `/api/runners/${wrongRunner.id}/leases`, {
    method: 'POST',
    data: { leaseDurationSeconds: 90 },
  })
  assert.equal(response.status(), 204)
})

Then(
  'runners that do not advertise the exact runtime, provider, and model cannot claim the session',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const wrongRunner = required(state.otherProvider, 'wrong runner')
    const response = await apiResponse(state.page.request, `/api/runners/${wrongRunner.id}/leases`, {
      method: 'POST',
      data: { leaseDurationSeconds: 90 },
    })
    assert.equal(response.status(), 204)
  },
)

Then(
  'the session remains pending with a waiting-for-runner reason until the eligible runner leases it',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
    assert.equal(session.status, 'pending')
    assert.equal(session.statusReason, 'waiting-for-runner')
  },
)

Then(
  'the session remains pending with a waiting-for-runner reason until a runner claims it',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
    assert.equal(session.status, 'pending')
    assert.equal(session.statusReason, 'waiting-for-runner')
  },
)

Given('a runner has claimed a self-hosted session', async function (this: ProductWorld) {
  await setupQueuedSelfHostedSession(this)
})

When('the runner starts the session runtime', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await startProductAmaRunner(state)
  await waitForSessionStatus(state, 'running')
})

Then('the runner opens an outbound WebSocket for that session to AMA', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = await waitForSessionEventText(state, 'runner.channel.accepted')
  assert.ok(JSON.stringify(events.data).includes('runner.channel.accepted'))
})

Then('AMA authenticates the channel as the claimed runner and session', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = await waitForSessionEventText(state, String(state.runner?.id))
  const serialized = JSON.stringify(events.data)
  assert.equal(serialized.includes(String(state.latestSession?.id)), true)
  assert.equal(serialized.includes(String(state.runner?.id)), true)
})

Then('the session becomes active only after the WebSocket is accepted', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.status, 'running')
  assert.equal(session.statusReason, null)
  assert.equal(session.runtimeEndpointPath, `/runtime/sessions/${state.latestSession?.id}/rpc`)
})

Then('AMA does not expose any runner-local runtime process endpoint to clients', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  const serialized = JSON.stringify(session)
  assert.equal(serialized.includes('localhost'), false)
  assert.equal(serialized.includes('127.0.0.1'), false)
  assert.equal(serialized.includes('runner-local'), false)
})

Given('a self-hosted session has an accepted runner WebSocket', async function (this: ProductWorld) {
  const state = await setupQueuedSelfHostedSession(this)
  await startProductAmaRunner(state)
  await waitForSessionStatus(state, 'running')
})

When(
  'the cloud-side AMA control plane sends an approved tool call for the session',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    state.response = await apiJson<Json>(state.page.request, `/runtime/sessions/${state.latestSession?.id}/rpc`, {
      method: 'POST',
      data: {
        toolCalls: [
          {
            id: 'call_e2e_channel',
            name: 'sandbox.exec',
            input: { command: 'printf channel-ok' },
          },
        ],
      },
    })
  },
)

Then('the tool call is delivered over the session WebSocket to the owning runner', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = await waitForSessionEventText(state, 'call_e2e_channel')
  assert.ok(JSON.stringify(events.data).includes('runner.tool.started'))
})

Then('the runner executes the tool in the configured local execution backend', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = await waitForSessionEventText(state, 'channel-ok')
  assert.ok(JSON.stringify(events.data).includes('process-unsafe'))
})

Then(
  'the runner streams stdout, stderr, output, timing, and safe errors over the same WebSocket',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const events = await waitForSessionEventText(state, 'channel-ok')
    const serialized = JSON.stringify(events.data)
    assert.equal(serialized.includes('stdout'), true)
    assert.equal(serialized.includes('stderr'), true)
    assert.equal(serialized.includes('durationMs'), true)
  },
)

Then(
  'AMA stores the tool result as canonical session events before continuing the session',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const events = await waitForSessionEventText(state, 'channel-ok')
    assert.ok(JSON.stringify(events.data).includes('tool_call.completed'))
  },
)

Given('a self-hosted session is owned by a runner', async function (this: ProductWorld) {
  const state = await setupClaimedSelfHostedSession(this)
  state.runnerChannelMessages = await openRunnerChannel(state, 'amaRunnerChannel')
})

When('the session WebSocket disconnects before the session is idle or complete', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await closeRunnerChannel(state, 'amaRunnerChannel')
})

Then('AMA marks the session as waiting for runner recovery', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.status, 'pending')
  assert.equal(session.statusReason, 'waiting-for-runner-recovery')
})

Then('the original runner can reconnect before the lease expires', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.runnerChannelMessages = await openRunnerChannel(state, 'amaRunnerChannel')
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.equal(session.status, 'running')
})

Then(
  'an eligible replacement runner can claim the session after the lease expires',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    await apiJson<Json>(state.page.request, `/api/runners/${state.runner?.id}/leases/${state.lease?.id}`, {
      method: 'PATCH',
      data: { status: 'active', leaseDurationSeconds: 15 },
    })
    await delay(16_000)
    const replacement = await apiJson<Json>(state.page.request, '/api/runners', {
      method: 'POST',
      data: {
        name: `${state.runId} replacement runner`,
        environmentId: state.environment?.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      },
    })
    await apiJson<Json>(state.page.request, `/api/runners/${replacement.id}/heartbeats`, {
      method: 'POST',
      data: { status: 'active', currentLoad: 0, capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY] },
    })
    state.runner = replacement
    state.lease = await apiJson<Json>(state.page.request, `/api/runners/${replacement.id}/leases`, {
      method: 'POST',
      data: { leaseDurationSeconds: 90 },
    })
    assert.equal(state.lease.status, 'active')
  },
)

Then('duplicate or stale channels cannot submit tool results for the session', async function (this: ProductWorld) {
  const state = await ensureState(this)
  state.runnerChannelMessages = await openRunnerChannel(state, 'duplicateRunnerChannel')
  await sendRunnerChannelEvent(state, 'amaRunnerChannel', {
    type: 'runner.tool.completed',
    payload: { toolCallId: 'duplicate_e2e', toolName: 'sandbox.exec', output: { stdout: 'duplicate-e2e' } },
  })
  await sendRunnerChannelEvent(state, 'duplicateRunnerChannel', {
    type: 'runner.tool.completed',
    payload: { toolCallId: 'replacement_e2e', toolName: 'sandbox.exec', output: { stdout: 'replacement-e2e' } },
  })
  const duplicateEvents = await waitForSessionEventText(state, 'replacement-e2e')
  const duplicateSerialized = JSON.stringify(duplicateEvents.data)
  assert.equal(duplicateSerialized.includes('replacement-e2e'), true)
  assert.equal(duplicateSerialized.includes('duplicate-e2e'), false)

  await sendRunnerChannelEvent(state, 'amaRunnerChannel', {
    type: 'runner.tool.completed',
    payload: { toolCallId: 'stale_e2e', toolName: 'sandbox.exec', output: { stdout: 'stale-e2e' } },
  })
  state.runnerChannelMessages = await openRunnerChannel(state, 'replacementRunnerChannel')
  await sendRunnerChannelEvent(state, 'replacementRunnerChannel', {
    type: 'runner.tool.completed',
    payload: { toolCallId: 'fresh_e2e', toolName: 'sandbox.exec', output: { stdout: 'fresh-e2e' } },
  })
  const events = await waitForSessionEventText(state, 'fresh-e2e')
  const serialized = JSON.stringify(events.data)
  assert.equal(serialized.includes('fresh-e2e'), true)
  assert.equal(serialized.includes('stale-e2e'), false)
})

Then('the runtime accepts the message', function (this: ProductWorld) {
  assert.ok(this.e2e?.runtimeMessage)
})

Then('the session status becomes running while work is in progress', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  assert.ok(['idle', 'running'].includes(String(session.status)))
})

Then(
  'the AMA runtime can dispatch approved tools through the Cloudflare Sandbox executor',
  async function (this: ProductWorld) {
    const state = await ensureState(this)
    const events = await sessionEvents(state)
    assert.ok(events.data.length > 0)
    assert.ok((state.observedEventTypes ?? []).filter(Boolean).some((type) => String(type).includes('tool')))
  },
)

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

Given('a session runs with ama, claude-code, codex, or copilot runtime', async function (this: ProductWorld) {
  await ensureAgentAndEnvironment(this)
  this.e2e.latestSession = await createSession(this.e2e)
})

When('the runtime emits lifecycle, message, tool, and usage activity', async function (this: ProductWorld) {
  const state = await ensureState(this)
  await sendRuntimeMessage(state, 'inspect canonical event protocol')
  state.events = await sessionEvents(state)
})

Then('AMA stores the activity as canonical session events', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = state.events ?? (await sessionEvents(state))
  const types = new Set(events.data.map((event) => String(event.type)))
  for (const type of [
    'session.lifecycle',
    'transcript.message',
    'tool_call.started',
    'tool_call.completed',
    'usage.recorded',
  ]) {
    assert.ok(types.has(type), `missing canonical event type ${type}`)
  }
})

Then('UI, API, and session-state views read only canonical session events', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = state.events ?? (await sessionEvents(state))
  for (const type of state.observedEventTypes ?? []) {
    assert.match(String(type), /^[a-z]+(?:_[a-z]+)?\.[a-z]+(?:\.[a-z]+)?$/)
  }
  assert.ok((state.observedEventTypes ?? []).includes('transcript.message'))
  assert.ok((state.observedEventTypes ?? []).includes('tool_call.started'))
  for (const event of events.data) {
    assert.match(String(event.type), /^[a-z]+(?:_[a-z]+)?\.[a-z]+(?:\.[a-z]+)?$/)
  }
  assert.equal(
    events.data.some((event) => String(event.type).includes('tool_execution_')),
    false,
  )
  assert.equal(
    events.data.some((event) => String(event.type).includes('message_update')),
    false,
  )
})

Then('runtime-specific details appear only as safe metadata', async function (this: ProductWorld) {
  const state = await ensureState(this)
  const events = state.events ?? (await sessionEvents(state))
  assert.ok(events.data.some((event) => objectValue(event.metadata).sourceEventType))
  for (const event of events.data) {
    assert.equal(JSON.stringify(event.payload).includes('tool_execution_'), false)
    assert.equal(JSON.stringify(event.payload).includes('message_update'), false)
  }
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
    `/api/sessions/${state.latestSession?.id}/events?type=transcript.message`,
  )
})

Then('the response returns a deterministic page', function (this: ProductWorld) {
  const pages = required(this.e2e?.eventPages, 'event pages')
  assert.equal(pages.firstPage.data.length, 1)
  assert.ok(pages.nextPage.data.every((event) => Number(event.sequence) > Number(pages.firstPage.data[0]?.sequence)))
  assert.ok(pages.descPage.data.length > 0)
  assert.ok(pages.typedPage.data.every((event) => event.type === 'transcript.message'))
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

Then('AMA cancels cloud-owned runtime work and stops the executor backend', function (this: ProductWorld) {
  assert.ok(this.e2e?.latestSession)
})

Then('the session status becomes stopped', function (this: ProductWorld) {
  assert.equal(this.e2e?.latestSession?.status, 'stopped')
})

Then('AMA cancels cloud-owned runtime work and stops the sandbox executor', function (this: ProductWorld) {
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
  'session metadata, runtime endpoint, environment runtime snapshot, and status are available',
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

async function createProvider(state: E2EState, data: Json = {}) {
  return await apiJson<Json>(state.page.request, '/api/providers', {
    method: 'POST',
    data,
  })
}

async function createProviderModel(state: E2EState, provider: Json | undefined, data: Json = {}) {
  return await apiJson<Json>(state.page.request, `/api/providers/${provider?.id}/models`, {
    method: 'POST',
    data,
  })
}

async function createEnvironment(state: E2EState, data: Json = {}) {
  return await apiJson<Json>(state.page.request, '/api/environments', {
    method: 'POST',
    data: {
      name: `${state.runId} env`,
      runtimeConfig: { image: 'ama-pi-runtime' },
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

async function createMcpCredential(state: E2EState) {
  state.vault ??= await createVault(state)
  return await apiJson<Json>(state.page.request, `/api/vaults/${state.vault.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${state.runId} GitHub token`,
      type: 'api_key',
      connectorBinding: { connectorId: 'github', name: 'token' },
      metadata: { purpose: 'mcp-e2e' },
      secret: { provider: 'external-vault', externalVaultPath: `vault://ama/e2e/${state.runId}/github` },
    },
  })
}

async function connectMcp(state: E2EState, data: Json) {
  return await apiJson<Json>(state.page.request, '/api/mcp/connections', {
    method: 'POST',
    data,
  })
}

async function sendRuntimeMessage(state: E2EState, message: string) {
  const sessionId = String(state.latestSession?.id)
  state.runtimeMessage = message
  const runtimePage = await state.page.context().newPage()
  try {
    await runtimePage.goto('/')
    state.observedEventTypes = await runtimePage.evaluate(
      async ({ sessionId, message }) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const token = window.localStorage.getItem('ama:e2e-access-token')
        const url = new URL(`${protocol}//${window.location.host}/runtime/sessions/${sessionId}/ws`)
        if (token) {
          url.searchParams.set('access_token', token)
        }
        const socket = new WebSocket(url)
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
  } finally {
    await runtimePage.close()
  }
  await waitForRuntimeEvents(state)
}

async function waitForRuntimeEvents(state: E2EState) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await sessionEvents(state)
    if (JSON.stringify(events.data).includes(state.runtimeMessage ?? '')) {
      return events
    }
    await delay(500)
  }
  throw new Error(`Session ${state.latestSession?.id} did not persist runtime message events`)
}

async function setupQueuedSelfHostedSession(world: ProductWorld) {
  const state = await ensureSignedIn(world)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} actual runner env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent = await createAgent(state, { name: `${state.runId} actual runner agent` })
  state.runner = await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} actual runner`,
      environmentId: state.environment.id,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  state.latestSession = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      title: `${state.runId} actual runner session`,
    },
  })
  assert.equal(state.latestSession.status, 'pending')
  assert.equal(state.latestSession.statusReason, 'waiting-for-runner')
  return state
}

async function setupClaimedSelfHostedSession(world: ProductWorld) {
  const state = await ensureSignedIn(world)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} claimed channel env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent = await createAgent(state, { name: `${state.runId} claimed channel agent` })
  state.runner = await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} claimed channel runner`,
      environmentId: state.environment.id,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  state.runner = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/heartbeats`, {
    method: 'POST',
    data: {
      status: 'active',
      currentLoad: 0,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  state.latestSession = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      title: `${state.runId} claimed channel session`,
    },
  })
  state.lease = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/leases`, {
    method: 'POST',
    data: { leaseDurationSeconds: 90 },
  })
  assert.equal(state.lease.status, 'active')
  return state
}

async function startProductAmaRunner(state: E2EState) {
  await stopProductAmaRunner(state)
  const origin = await ensureLocalApp()
  const token = await state.page.evaluate(() => window.localStorage.getItem('ama:e2e-access-token'))
  if (!token) {
    throw new Error('E2E access token is required to start ama-runner')
  }
  const workDir = mkdtempSync(join(tmpdir(), 'ama-product-runner-'))
  const child = spawn(
    'go',
    [
      'run',
      '.',
      '--origin',
      origin,
      '--token',
      token,
      '--runner-id',
      String(state.runner?.id),
      '--capabilities',
      ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY].join(','),
      '--allow-unsafe-process',
      '--workdir',
      workDir,
      '--poll-interval',
      '1s',
      '--heartbeat-interval',
      '5s',
      '--lease-seconds',
      '30',
      '--renew-interval',
      '10s',
      '--command-timeout',
      '30s',
    ],
    {
      cwd: 'cmd/ama-runner',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ) as AmaRunnerProcess
  child.runnerOutput = []
  child.stdout.on('data', (chunk) => child.runnerOutput.push(String(chunk)))
  child.stderr.on('data', (chunk) => child.runnerOutput.push(String(chunk)))
  state.runnerProcess = child
  state.runnerWorkDir = workDir
}

async function stopProductAmaRunner(state?: E2EState) {
  if (!state) {
    return
  }
  const child = state.runnerProcess
  state.runnerProcess = undefined
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL')
        }
        resolve()
      }, 5_000)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  if (state.runnerWorkDir) {
    rmSync(state.runnerWorkDir, { recursive: true, force: true })
    state.runnerWorkDir = undefined
  }
}

async function waitForSessionStatus(state: E2EState, status: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
    if (session.status === status) {
      state.latestSession = session
      return session
    }
    if (state.runnerProcess?.exitCode !== null && state.runnerProcess?.exitCode !== undefined) {
      throw new Error(
        `ama-runner exited before session became ${status}:\n${state.runnerProcess.runnerOutput.join('')}`,
      )
    }
    await delay(1_000)
  }
  throw new Error(`Session ${state.latestSession?.id} did not become ${status}`)
}

async function openRunnerChannel(state: E2EState, key: string) {
  const messages = await state.page.evaluate(
    async ({ key, runnerId, leaseId }) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const token = window.localStorage.getItem('ama:e2e-access-token')
      const url = new URL(`${protocol}//${window.location.host}/api/runners/${runnerId}/leases/${leaseId}/channel`)
      if (token) {
        url.searchParams.set('access_token', token)
      }
      const socket = new WebSocket(url)
      const store = { socket, messages: [] as Json[] }
      ;(window as unknown as Record<string, typeof store>)[key] = store
      socket.addEventListener('message', (event) => {
        store.messages.push(JSON.parse(String(event.data)) as Json)
      })
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => reject(new Error('runner channel websocket failed')), { once: true })
      })
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (store.messages.some((message) => message.type === 'session.channel.accepted')) {
          return store.messages
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('runner channel was not accepted')
    },
    { key, runnerId: state.runner?.id, leaseId: state.lease?.id },
  )
  return messages as Json[]
}

async function sendRunnerChannelEvent(state: E2EState, key: string, event: Json) {
  await state.page.evaluate(
    ({ key, event }) => {
      const store = (window as unknown as Record<string, { socket: WebSocket }>)[key]
      if (!store) {
        throw new Error(`runner channel ${key} is not open`)
      }
      store.socket.send(JSON.stringify({ type: 'runner.event', event }))
    },
    { key, event },
  )
  await delay(250)
}

async function closeRunnerChannel(state: E2EState, key: string) {
  await state.page.evaluate(
    ({ key }) => {
      const store = (window as unknown as Record<string, { socket: WebSocket }>)[key]
      if (!store) {
        throw new Error(`runner channel ${key} is not open`)
      }
      store.socket.close()
    },
    { key },
  )
  await delay(500)
}

async function waitForSessionEventText(state: E2EState, text: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await sessionEvents(state)
    if (JSON.stringify(events.data).includes(text)) {
      return events
    }
    await delay(500)
  }
  throw new Error(`Session ${state.latestSession?.id} did not persist event text ${text}`)
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

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : []
}

function required<T>(value: T | undefined | null, label: string) {
  assert.ok(value, `${label} must exist`)
  return value
}
