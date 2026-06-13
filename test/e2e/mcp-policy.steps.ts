import assert from 'node:assert/strict'
import { After, Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import { type McpFixtureServer, startMcpFixtureServer } from './mcp-server-fixture'
import {
  createAgent,
  createEnvironment,
  createSession,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
  sessionEvents,
} from './shared-helpers'

interface CatalogBrowse {
  all: ListResponse<Json>
  byCapability: ListResponse<Json>
  byTrustLevel: ListResponse<Json>
  bySearch: ListResponse<Json>
}

interface ToolCallOutcome {
  status: number
  body: Json
}

interface McpPolicyState {
  fixture?: McpFixtureServer
  secretValue?: string
  vault?: Json
  githubConnection?: Json
  linearConnection?: Json
  blockedAttachOutcome?: ToolCallOutcome
  tooledAgent?: Json
  browse?: CatalogBrowse
  allowedCall?: ToolCallOutcome
  deniedCall?: ToolCallOutcome
  environmentDeniedCall?: ToolCallOutcome
  fixtureRequestsBeforeDeniedCall?: number
  fixtureRequestsAfterDeniedCall?: number
}

type McpPolicyWorld = StepsWorld & { mcpPolicy?: McpPolicyState }

const fixturesToClose: McpFixtureServer[] = []

After(async () => {
  await Promise.all(fixturesToClose.splice(0).map((fixture) => fixture.close().catch(() => {})))
})

function policyState(world: McpPolicyWorld): McpPolicyState {
  world.mcpPolicy ??= {}
  return world.mcpPolicy
}

// Project policy is a scoped collection now: upsert the project-scoped policy
// instead of the removed project-singleton PUT.
async function setProjectPolicy(e2e: E2EState, body: Json) {
  const existing = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/policies')
  const projectPolicy = existing.data.find(
    (policy) => (policy.scope as Json | undefined)?.level === 'project' && !(policy.scope as Json).teamId,
  )
  if (projectPolicy) {
    return await apiJson<Json>(e2e.page.request, `/api/v1/policies/${projectPolicy.id}`, {
      method: 'PUT',
      data: { scope: { level: 'project' }, ...body },
    })
  }
  return await apiJson<Json>(e2e.page.request, '/api/v1/policies', {
    method: 'POST',
    data: { scope: { level: 'project' }, ...body },
  })
}

async function startFixture(state: McpPolicyState, secretValue: string) {
  state.secretValue = secretValue
  state.fixture = await startMcpFixtureServer([secretValue])
  fixturesToClose.push(state.fixture)
  return state.fixture
}

async function connectConnectorToFixture(e2e: E2EState, state: McpPolicyState, connectorId: string) {
  assert.ok(state.fixture, 'fixture must be running')
  state.vault ??= await apiJson<Json>(e2e.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${e2e.runId} mcp policy vault` },
  })
  const credential = await apiJson<Json>(e2e.page.request, `/api/v1/vaults/${state.vault.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${e2e.runId} ${connectorId} token`,
      type: 'api_key',
      connectorBinding: { connectorId, name: 'token' },
      secret: { provider: 'cloudflare-secrets', secretValue: state.secretValue },
    },
  })
  const connection = await apiJson<Json>(e2e.page.request, '/api/v1/connections', {
    method: 'POST',
    data: {
      connectorId,
      credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
      endpointUrl: state.fixture.url,
    },
  })
  // Live-sync the connector tools from the fixture MCP server so policy checks
  // run against the real tool surface.
  await apiJson<ListResponse<Json>>(e2e.page.request, `/api/v1/connections/${connection.id}/tools`)
  return connection
}

async function callConnectionTool(
  e2e: E2EState,
  connectionId: unknown,
  toolName: string,
  input: Json,
): Promise<ToolCallOutcome> {
  const response = await apiResponse(e2e.page.request, `/api/v1/connections/${connectionId}/tools/${toolName}/calls`, {
    method: 'POST',
    data: { sessionId: e2e.latestSession?.id, input },
  })
  return { status: response.status(), body: (await response.json()) as Json }
}

function objectValue(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

// ─── Background: a project has tool and MCP policies ─────────────────────────

Given('a project has tool and MCP policies', async function (this: McpPolicyWorld) {
  const e2e = await ensureSignedIn(this)
  await setProjectPolicy(e2e, {
    toolPolicy: { blockedTools: ['repo.delete'] },
    mcpPolicy: {},
  })
})

// ─── Scenario: Attach tools to an agent version ──────────────────────────────

When('the user configures tools for an agent', async function (this: McpPolicyWorld) {
  const e2e = await ensureSignedIn(this)
  const state = policyState(this)

  // A governance-blocked tool is rejected at save time.
  const blocked = await apiResponse(e2e.page.request, '/api/v1/agents', {
    method: 'POST',
    data: { name: `${e2e.runId} blocked tool agent`, tools: [{ name: 'repo.delete' }] },
  })
  state.blockedAttachOutcome = { status: blocked.status(), body: (await blocked.json()) as Json }

  state.tooledAgent = await createAgent(e2e, {
    name: `${e2e.runId} tooled agent`,
    tools: [
      {
        name: 'web.search',
        description: 'Search the public web for supporting sources.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        approvalMode: 'per_call',
        policyMetadata: { sensitivity: 'low', category: 'research' },
      },
      { name: 'repo.read' },
    ],
  })
})

Then(
  'each tool is stored with name, description, schema, approval mode, and policy metadata',
  async function (this: McpPolicyWorld) {
    const e2e = this.e2e
    const state = policyState(this)
    assert.ok(e2e, 'e2e state must exist')
    assert.ok(state.tooledAgent, 'agent must be created')

    const versions = await apiJson<ListResponse<Json>>(
      e2e.page.request,
      `/api/v1/agents/${state.tooledAgent.id}/versions`,
    )
    const version = versions.data[0]
    assert.ok(version, 'agent version must exist')
    const tools = version.tools as Json[]
    assert.equal(tools.length, 2)

    const webSearch = tools.find((tool) => tool.name === 'web.search')
    assert.ok(webSearch, 'web.search attachment must be stored on the version')
    assert.equal(webSearch.description, 'Search the public web for supporting sources.')
    assert.deepEqual(objectValue(webSearch.inputSchema).required, ['query'])
    assert.equal(webSearch.approvalMode, 'per_call')
    assert.deepEqual(webSearch.policyMetadata, { sensitivity: 'low', category: 'research' })

    // Sparse attachments are normalized so the stored contract is complete.
    const repoRead = tools.find((tool) => tool.name === 'repo.read')
    assert.ok(repoRead, 'repo.read attachment must be stored on the version')
    assert.equal(repoRead.description, null)
    assert.deepEqual(repoRead.inputSchema, {})
    assert.equal(repoRead.approvalMode, 'project_policy')
    assert.deepEqual(repoRead.policyMetadata, {})

    const blocked = state.blockedAttachOutcome
    assert.ok(blocked, 'blocked attachment attempt must be recorded')
    assert.equal(blocked.status, 400)
    const fields = objectValue(objectValue(objectValue(blocked.body.error).details).fields)
    assert.equal(fields.tools, 'Tool is blocked by policy: repo.delete')
  },
)

// ─── Scenario: Discover MCP connectors ───────────────────────────────────────

When('the user browses available MCP connectors', async function (this: McpPolicyWorld) {
  const e2e = await ensureSignedIn(this)
  const state = policyState(this)
  state.browse = {
    all: await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/connectors'),
    byCapability: await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/connectors?capability=repositories'),
    byTrustLevel: await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/connectors?trustLevel=verified'),
    bySearch: await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/connectors?search=GitHub'),
  }
})

Then(
  'connectors can be searched and filtered by capability, trust level, and policy status',
  function (this: McpPolicyWorld) {
    const state = policyState(this)
    const browse = state.browse
    assert.ok(browse, 'catalog browses must be recorded')

    assert.ok(browse.byCapability.data.length > 0, 'capability filter must match catalog entries')
    for (const row of browse.byCapability.data) {
      assert.ok((row.capabilities as string[]).includes('repositories'))
    }

    assert.ok(browse.byTrustLevel.data.length > 0, 'trust level filter must match catalog entries')
    for (const row of browse.byTrustLevel.data) {
      assert.equal(row.trustLevel, 'verified')
    }

    assert.ok(browse.bySearch.data.length > 0, 'search must match catalog entries')
    for (const row of browse.bySearch.data) {
      assert.ok(`${row.name} ${row.description}`.toLowerCase().includes('github'))
    }

    // The static catalog identifies entries by `id`; governance policy status
    // is no longer projected onto the catalog (it lives on /policies now).
    assert.ok(
      browse.all.data.some((row) => row.id === 'github'),
      'the static catalog lists the github connector by id',
    )
    assert.ok(
      browse.all.data.some((row) => row.id === 'linear'),
      'the static catalog lists the linear connector by id',
    )
  },
)

// ─── Scenario: Enforce MCP policy at runtime ─────────────────────────────────

Given('an MCP connector is blocked for a project', async function (this: McpPolicyWorld) {
  const e2e = await ensureSignedIn(this)
  const state = policyState(this)
  await startFixture(state, `mcp-policy-secret-${e2e.runId}`)
  state.githubConnection = await connectConnectorToFixture(e2e, state, 'github')

  e2e.agent = await createAgent(e2e, { name: `${e2e.runId} policy agent`, tools: [{ name: 'mcp:github' }] })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} policy env` })
  e2e.latestSession = await createSession(e2e)

  // The connector works through the real MCP client before it is blocked.
  state.allowedCall = await callConnectionTool(e2e, state.githubConnection.id, 'echo', { text: 'allowed by policy' })
  assert.equal(state.allowedCall.status, 201, `pre-block call failed: ${JSON.stringify(state.allowedCall.body)}`)

  await setProjectPolicy(e2e, { mcpPolicy: { blockedConnectors: ['github'] } })
})

When('an agent attempts to call the connector', async function (this: McpPolicyWorld) {
  const e2e = this.e2e
  const state = policyState(this)
  assert.ok(e2e, 'e2e state must exist')
  state.fixtureRequestsBeforeDeniedCall = state.fixture?.requestCount() ?? 0
  state.deniedCall = await callConnectionTool(e2e, state.githubConnection?.id, 'echo', { text: 'blocked by policy' })
  state.fixtureRequestsAfterDeniedCall = state.fixture?.requestCount() ?? 0
})

Then('the platform rejects the call', function (this: McpPolicyWorld) {
  const state = policyState(this)
  assert.equal(state.allowedCall?.status, 201, 'the allowed call must pass before the connector is blocked')
  assert.equal(state.deniedCall?.status, 403)
  assert.equal(objectValue(state.deniedCall?.body.error).type, 'policy_denied')
  assert.equal(
    state.fixtureRequestsAfterDeniedCall,
    state.fixtureRequestsBeforeDeniedCall,
    'a policy-blocked call must never reach the MCP server',
  )
})

Then('records a policy event', async function (this: McpPolicyWorld) {
  const e2e = this.e2e
  assert.ok(e2e, 'e2e state must exist')
  const events = await sessionEvents(e2e)
  const denied = events.data.find(
    (event) =>
      event.type === 'policy.decision' &&
      objectValue(event.payload).allowed === false &&
      objectValue(event.payload).connectorId === 'github',
  )
  assert.ok(denied, 'expected a denied policy.decision event on the session')
  const allowed = events.data.find(
    (event) => event.type === 'policy.decision' && objectValue(event.payload).allowed === true,
  )
  assert.ok(allowed, 'expected the earlier allowed call to record an allowed policy.decision event')

  const audit = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    '/api/v1/audit-records?action=connection_tool.call&limit=50',
  )
  assert.ok(
    audit.data.some((record) => record.outcome === 'denied' && record.sessionId === e2e.latestSession?.id),
    'expected a denied connection_tool.call audit record',
  )
  assert.ok(
    audit.data.some((record) => record.outcome === 'success' && record.sessionId === e2e.latestSession?.id),
    'expected the allowed call to be audited as success',
  )
})

// ─── Scenario: Apply environment MCP restrictions ────────────────────────────

Given('an environment restricts MCP connectors', async function (this: McpPolicyWorld) {
  const e2e = await ensureSignedIn(this)
  const state = policyState(this)
  await startFixture(state, `env-mcp-secret-${e2e.runId}`)
  state.githubConnection = await connectConnectorToFixture(e2e, state, 'github')
  state.linearConnection = await connectConnectorToFixture(e2e, state, 'linear')

  e2e.agent = await createAgent(e2e, {
    name: `${e2e.runId} env mcp agent`,
    tools: [{ name: 'mcp:github' }, { name: 'mcp:linear' }],
  })
  e2e.environment = await createEnvironment(e2e, {
    name: `${e2e.runId} restricted mcp env`,
    mcpPolicy: { allowedConnectors: ['github'] },
  })
})

When('a session uses the environment', async function (this: McpPolicyWorld) {
  const e2e = this.e2e
  assert.ok(e2e, 'e2e state must exist')
  e2e.latestSession = await createSession(e2e)
})

Then(
  'the runtime allows only connectors permitted by the environment and project policy',
  async function (this: McpPolicyWorld) {
    const e2e = this.e2e
    const state = policyState(this)
    assert.ok(e2e, 'e2e state must exist')

    // The environment-allowed connector executes through the real MCP client.
    state.allowedCall = await callConnectionTool(e2e, state.githubConnection?.id, 'echo', { text: 'env allowed' })
    assert.equal(state.allowedCall.status, 201, `allowed call failed: ${JSON.stringify(state.allowedCall.body)}`)

    // The agent allows the linear connector, but the environment snapshot
    // bound to the session does not.
    const requestsBefore = state.fixture?.requestCount() ?? 0
    state.environmentDeniedCall = await callConnectionTool(e2e, state.linearConnection?.id, 'echo', {
      text: 'env blocked',
    })
    assert.equal(state.environmentDeniedCall.status, 403)
    const error = objectValue(state.environmentDeniedCall.body.error)
    assert.equal(error.type, 'policy_denied')
    assert.equal(objectValue(error.details).ruleId, 'environment.mcp.allowedConnectors')
    assert.equal(
      state.fixture?.requestCount(),
      requestsBefore,
      'an environment-blocked call must never reach the MCP server',
    )

    const events = await sessionEvents(e2e)
    const allowedDecision = events.data.find(
      (event) =>
        event.type === 'policy.decision' &&
        objectValue(event.payload).allowed === true &&
        objectValue(event.payload).connectorId === 'github',
    )
    const deniedDecision = events.data.find(
      (event) =>
        event.type === 'policy.decision' &&
        objectValue(event.payload).allowed === false &&
        objectValue(event.payload).connectorId === 'linear',
    )
    assert.ok(allowedDecision, 'expected an allowed policy.decision event for the permitted connector')
    assert.ok(deniedDecision, 'expected a denied policy.decision event for the restricted connector')
    assert.equal(objectValue(deniedDecision.payload).ruleId, 'environment.mcp.allowedConnectors')
  },
)
