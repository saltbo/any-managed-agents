import assert from 'node:assert/strict'
import { After, Given, Then, When } from '@cucumber/cucumber'
import type { Page } from '@playwright/test'
import { apiJson, apiResponse, authenticateE2EPage, openLocalPage } from './local-app'
import {
  allocateDeadPort,
  MCP_FIXTURE_RAW_ERROR_MARKER,
  type McpFixtureServer,
  startMcpFixtureServer,
} from './mcp-server-fixture'
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

interface McpClientState {
  fixture?: McpFixtureServer
  secretValue?: string
  rotatedSecretValue?: string
  credential?: Json
  vault?: Json
  connection?: Json
  linearConnection?: Json
  callStatus?: number
  callBody?: Json
  tools?: ListResponse<Json>
  normalizedFailures?: Array<{ label: string; status: number; mcpErrorType: string; raw: string }>
  fixtureRequestsBeforeAttempt?: number
  fixtureRequestsAfterDeniedAttempt?: number
  deniedStatus?: number
  deniedBody?: Json
  allowedStatus?: number
  allowedBody?: Json
  rotatedSession?: Json
  originalConnectedAt?: string
  otherPage?: Page
}

type McpWorld = StepsWorld & { mcpClient?: McpClientState }

const fixturesToClose: McpFixtureServer[] = []
const pagesToClose: Page[] = []

After(async () => {
  await Promise.all(fixturesToClose.splice(0).map((fixture) => fixture.close().catch(() => {})))
  await Promise.all(pagesToClose.splice(0).map((page) => page.close().catch(() => {})))
})

function mcpState(world: McpWorld): McpClientState {
  world.mcpClient ??= {}
  return world.mcpClient
}

async function startFixture(state: McpClientState, tokens: string[]) {
  state.fixture = await startMcpFixtureServer(tokens)
  fixturesToClose.push(state.fixture)
  return state.fixture
}

async function createConnectorCredential(
  e2e: E2EState,
  state: McpClientState,
  connectorId: string,
  secretValue: string,
) {
  state.vault ??= await apiJson<Json>(e2e.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${e2e.runId} mcp vault` },
  })
  return await apiJson<Json>(e2e.page.request, `/api/v1/vaults/${state.vault.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${e2e.runId} ${connectorId} token`,
      type: 'api_key',
      connectorBinding: { connectorId, name: 'token' },
      metadata: { purpose: 'mcp-client-e2e' },
      secret: { provider: 'cloudflare-secrets', secretValue },
    },
  })
}

// Connection create takes a unified credentialRef; the helper bridges the old
// {credentialId, credentialVersionId} call sites onto the v1 shape.
async function connectConnector(e2e: E2EState, values: Json) {
  const { credentialId, credentialVersionId, ...rest } = values as {
    credentialId?: string
    credentialVersionId?: string
  } & Json
  const body: Json = { ...rest }
  if (credentialId !== undefined) {
    body.credentialRef = {
      credentialId,
      ...(credentialVersionId !== undefined ? { versionId: credentialVersionId } : {}),
    }
  }
  return await apiJson<Json>(e2e.page.request, '/api/v1/connections', { method: 'POST', data: body })
}

async function callConnectionTool(
  e2e: E2EState,
  connectionId: unknown,
  toolName: string,
  sessionId: unknown,
  input: Json,
) {
  const response = await apiResponse(e2e.page.request, `/api/v1/connections/${connectionId}/tools/${toolName}/calls`, {
    method: 'POST',
    data: { sessionId, input },
  })
  return { status: response.status(), body: (await response.json()) as Json }
}

async function listConnectionTools(e2e: E2EState, connectionId: unknown) {
  return await apiJson<ListResponse<Json>>(e2e.page.request, `/api/v1/connections/${connectionId}/tools`)
}

// Policies are a scoped collection now: POST creates, but a project policy can
// only exist once (409 on the second POST), so subsequent updates replace the
// existing policy by id.
async function upsertProjectMcpPolicy(e2e: E2EState, body: Json) {
  const response = await apiResponse(e2e.page.request, '/api/v1/policies', {
    method: 'POST',
    data: { scope: { level: 'project' }, ...body },
  })
  if (response.status() === 201) {
    return (await response.json()) as Json
  }
  if (response.status() !== 409) {
    throw new Error(`POST /api/v1/policies returned ${response.status()}: ${await response.text()}`)
  }
  const existing = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/policies')
  const projectPolicy = existing.data.find((policy) => objectValue(policy.scope).level === 'project')
  assert.ok(projectPolicy, 'expected an existing project-scoped policy to replace')
  return await apiJson<Json>(e2e.page.request, `/api/v1/policies/${projectPolicy.id}`, {
    method: 'PUT',
    data: { scope: { level: 'project' }, ...body },
  })
}

async function createMcpSession(world: McpWorld, toolNames: string[]) {
  const e2e = await ensureSignedIn(world)
  e2e.agent = await createAgent(e2e, {
    name: `${e2e.runId} mcp agent`,
    tools: toolNames.map((name) => ({ name })),
  })
  e2e.environment ??= await createEnvironment(e2e, { name: `${e2e.runId} mcp env` })
  e2e.latestSession = await createSession(e2e)
  return e2e
}

async function connectGithubToFixture(world: McpWorld, secretValue: string) {
  const e2e = await ensureSignedIn(world)
  const state = mcpState(world)
  state.secretValue = secretValue
  const fixture = await startFixture(state, [secretValue])
  state.credential = await createConnectorCredential(e2e, state, 'github', secretValue)
  state.connection = await connectConnector(e2e, {
    connectorId: 'github',
    credentialId: state.credential.id,
    credentialVersionId: state.credential.activeVersionId,
    endpointUrl: fixture.url,
  })
  return { e2e, state }
}

function objectValue(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

// A recorded tool call reports connector failures on its own error field; the
// HTTP layer only surfaces control-plane errors (policy, validation, auth).
function mcpErrorType(body: Json) {
  return String(objectValue(body.error).type)
}

// ─── Scenario: Handle MCP transport failure (mcp-client.feature) ─────────────

When('an MCP transport fails', async function (this: McpWorld) {
  const e2e = await createMcpSession(this, ['mcp:github'])
  const state = mcpState(this)
  state.secretValue = `transport-secret-${e2e.runId}`
  state.credential = await createConnectorCredential(e2e, state, 'github', state.secretValue)
  const deadPort = await allocateDeadPort()
  state.connection = await connectConnector(e2e, {
    connectorId: 'github',
    credentialId: state.credential.id,
    credentialVersionId: state.credential.activeVersionId,
    endpointUrl: `http://127.0.0.1:${deadPort}/mcp`,
  })
  const result = await callConnectionTool(e2e, state.connection.id, 'repo.read', e2e.latestSession?.id, {
    repo: 'saltbo/any-managed-agents',
  })
  state.callStatus = result.status
  state.callBody = result.body
})

Then(
  'the session records a structured tool error and continues or terminates according to policy',
  async function (this: McpWorld) {
    const e2e = this.e2e
    const state = mcpState(this)
    assert.ok(e2e, 'e2e state must exist')
    // The tool call is executed and recorded, so it is addressable: 201 with a
    // ToolCall whose state reports the structured connector failure.
    assert.equal(state.callStatus, 201)
    assert.equal(state.callBody?.state, 'error')
    assert.equal(objectValue(state.callBody?.error).type, 'mcp_network_error')

    const events = await sessionEvents(e2e)
    const start = events.data.find((event) => event.type === 'tool_execution_start')
    const end = events.data.find(
      (event) => event.type === 'tool_execution_end' && objectValue(event.payload).isError === true,
    )
    assert.ok(start, 'expected a tool_execution_start event for the failed transport call')
    assert.ok(end, 'expected a structured tool_execution_end error event')
    assert.equal(end.parentEventId, start.id)
    assert.equal(objectValue(objectValue(end.payload).error).type, 'mcp_network_error')

    // Tool policy does not require termination for connector failures: the
    // session stays active after the structured error is recorded.
    const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
    assert.equal(session.state, 'idle')
  },
)

// ─── Scenario: List tools from a connected MCP server ────────────────────────

Given('a connector is connected with an approved credential', async function (this: McpWorld) {
  const e2e = await ensureSignedIn(this)
  await connectGithubToFixture(this, `list-tools-secret-${e2e.runId}`)
})

When('the platform lists MCP tools for that connector', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  state.tools = await listConnectionTools(e2e, state.connection?.id)
})

Then('the MCP client authenticates with the resolved credential', function (this: McpWorld) {
  const state = mcpState(this)
  assert.ok(state.fixture, 'fixture must be running')
  const listCalls = state.fixture.recordedCalls().filter((call) => call.method === 'tools/list')
  assert.ok(listCalls.length > 0, 'expected the MCP client to send tools/list to the fixture server')
  for (const call of listCalls) {
    assert.equal(call.authorization, `Bearer ${state.secretValue}`)
  }
})

Then('returns tool name, description, and input schema', function (this: McpWorld) {
  const state = mcpState(this)
  const tools = state.tools
  assert.ok(tools, 'tool listing must exist')
  for (const expected of ['echo', 'add', 'slow']) {
    const tool: Json | undefined = tools.data.find((row) => row.name === expected)
    assert.ok(tool, `expected live tool ${expected} in the listing`)
    assert.equal(typeof tool.description, 'string')
    assert.equal(objectValue(tool.inputSchema).type, 'object')
  }
  const echo = tools.data.find((row) => row.name === 'echo')
  assert.ok(objectValue(objectValue(echo?.inputSchema).properties).text, 'echo input schema must describe text input')
})

Then('the response is scoped to the current organization and project policy', async function (this: McpWorld) {
  const state = mcpState(this)
  for (const tool of state.tools?.data ?? []) {
    assert.equal(tool.connectionId, state.connection?.id)
    assert.equal(tool.connectorId, 'github')
  }
  const otherPage = await openLocalPage()
  pagesToClose.push(otherPage)
  await authenticateE2EPage(otherPage)
  const crossTenantRead = await apiResponse(otherPage.request, `/api/v1/connections/${state.connection?.id}/tools`)
  assert.equal(crossTenantRead.status(), 404)
})

// ─── Scenario: Call an MCP tool from a session ───────────────────────────────

Given('a session agent is allowed to use an MCP tool', async function (this: McpWorld) {
  const e2e = await createMcpSession(this, ['mcp:github'])
  const { state } = await connectGithubToFixture(this, `session-call-secret-${e2e.runId}`)
  // Live-sync the connector tools so the session can call them under policy.
  state.tools = await listConnectionTools(e2e, state.connection?.id)
})

When('the selected session runtime requests the tool', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  const result = await callConnectionTool(e2e, state.connection?.id, 'echo', e2e.latestSession?.id, {
    text: 'hello from the session runtime',
  })
  state.callStatus = result.status
  state.callBody = result.body
})

Then('AMA calls the MCP server through the MCP client', function (this: McpWorld) {
  const state = mcpState(this)
  assert.equal(state.callStatus, 201)
  assert.equal(state.callBody?.state, 'success')
  const content = objectValue(state.callBody?.output).content
  assert.ok(Array.isArray(content), 'tool output must include MCP content')
  assert.equal(objectValue(content[0]).text, 'echo:hello from the session runtime')
  const toolCall = state.fixture?.recordedCalls().find((call) => call.method === 'tools/call')
  assert.ok(toolCall, 'fixture must have received the tools/call request')
  assert.equal(toolCall.toolName, 'echo')
})

Then(
  'tool input, output summary, duration, and safe errors are recorded as session events',
  async function (this: McpWorld) {
    const e2e = this.e2e
    assert.ok(e2e, 'e2e state must exist')
    const events = await sessionEvents(e2e)
    const policy = events.data.find(
      (event) => event.type === 'policy.decision' && objectValue(event.payload).operation === 'mcp_tool_call',
    )
    assert.ok(policy, 'expected a policy.decision event before the tool call')
    assert.equal(objectValue(policy.payload).allowed, true)

    const start = events.data.find((event) => event.type === 'tool_execution_start')
    assert.ok(start, 'expected a tool_execution_start event')
    assert.equal(objectValue(objectValue(start.payload).input).text, 'hello from the session runtime')

    const end = events.data.find((event) => event.type === 'tool_execution_end')
    assert.ok(end, 'expected a tool_execution_end event')
    assert.equal(end.parentEventId, start.id)
    assert.equal(end.correlationId, start.correlationId)
    assert.equal(objectValue(end.payload).isError, false)
    assert.equal(typeof objectValue(end.payload).durationMs, 'number')
    assert.ok(objectValue(objectValue(end.payload).outputSummary).contentItems, 'expected an output summary')
  },
)

Then('secret values are redacted from events and logs', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  assert.ok(state.secretValue, 'secret value must exist')
  const events = await sessionEvents(e2e)
  assert.equal(JSON.stringify(events).includes(state.secretValue), false)
  const audit = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/audit-records?limit=100')
  assert.equal(JSON.stringify(audit).includes(state.secretValue), false)
  assert.equal(JSON.stringify(state.callBody ?? {}).includes(state.secretValue), false)
})

// ─── Scenario: Normalize MCP client errors ───────────────────────────────────

Given(
  'an MCP server returns unauthorized, not found, timeout, invalid schema, or network errors',
  async function (this: McpWorld) {
    const e2e = await createMcpSession(this, ['mcp:github', 'mcp:linear'])
    const { state } = await connectGithubToFixture(this, `normalize-secret-${e2e.runId}`)
    // Sync live github tools (echo/add/slow) for schema and timeout failures.
    state.tools = await listConnectionTools(e2e, state.connection?.id)
    // A second connector presents a credential the server does not accept.
    const rejectedCredential = await createConnectorCredential(e2e, state, 'linear', `rejected-secret-${e2e.runId}`)
    state.linearConnection = await connectConnector(e2e, {
      connectorId: 'linear',
      credentialId: rejectedCredential.id,
      credentialVersionId: rejectedCredential.activeVersionId,
      endpointUrl: state.fixture?.url,
    })
  },
)

When('the MCP client handles the failure', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  const sessionId = e2e.latestSession?.id
  const failures: NonNullable<McpClientState['normalizedFailures']> = []
  const record = async (label: string, connectionId: unknown, toolName: string, input: Json) => {
    const result = await callConnectionTool(e2e, connectionId, toolName, sessionId, input)
    failures.push({
      label,
      status: result.status,
      mcpErrorType: mcpErrorType(result.body),
      raw: JSON.stringify(result.body),
    })
  }

  await record('unauthorized', state.linearConnection?.id, 'issue.read', { issueId: 'AMA-1' })
  await record('invalid_schema', state.connection?.id, 'add', { a: 'one', b: 'two' })

  await apiJson<Json>(e2e.page.request, `/api/v1/connections/${state.connection?.id}`, {
    method: 'PATCH',
    data: { metadata: { requestTimeoutMs: 500 } },
  })
  await record('timeout', state.connection?.id, 'slow', {})

  const fixtureOrigin = String(state.fixture?.url).replace(/\/mcp$/, '')
  await apiJson<Json>(e2e.page.request, `/api/v1/connections/${state.connection?.id}`, {
    method: 'PATCH',
    data: { endpointUrl: `${fixtureOrigin}/not-the-mcp-endpoint` },
  })
  await record('not_found', state.connection?.id, 'echo', { text: 'missing endpoint' })

  const deadPort = await allocateDeadPort()
  await apiJson<Json>(e2e.page.request, `/api/v1/connections/${state.connection?.id}`, {
    method: 'PATCH',
    data: { endpointUrl: `http://127.0.0.1:${deadPort}/mcp` },
  })
  await record('network', state.connection?.id, 'echo', { text: 'dead port' })

  state.normalizedFailures = failures
})

Then('AMA maps it to a stable error type and HTTP status for control-plane calls', function (this: McpWorld) {
  const state = mcpState(this)
  const failures = state.normalizedFailures
  assert.ok(failures, 'normalized failures must be recorded')
  const expected: Record<string, string> = {
    unauthorized: 'mcp_unauthorized',
    invalid_schema: 'mcp_invalid_schema',
    timeout: 'mcp_timeout',
    not_found: 'mcp_not_found',
    network: 'mcp_network_error',
  }
  for (const [label, type] of Object.entries(expected)) {
    const failure: { label: string; status: number; mcpErrorType: string; raw: string } | undefined = failures.find(
      (entry) => entry.label === label,
    )
    assert.ok(failure, `expected a recorded ${label} failure`)
    // Connector failures are recorded tool calls (201); the stable error type
    // lives on the ToolCall.error, never as a control-plane HTTP error.
    assert.equal(failure.status, 201, `${label} failure must be recorded as a tool call`)
    assert.equal(failure.mcpErrorType, type)
    assert.equal(
      failure.raw.includes(MCP_FIXTURE_RAW_ERROR_MARKER),
      false,
      `raw connector error text must not reach the ${label} API response`,
    )
  }
})

Then('runtime sessions continue or terminate according to tool policy', async function (this: McpWorld) {
  const e2e = this.e2e
  assert.ok(e2e, 'e2e state must exist')
  const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.equal(session.state, 'idle', 'connector failures must not terminate the session under default policy')
  const events = await sessionEvents(e2e)
  const failedEnds = events.data.filter(
    (event) => event.type === 'tool_execution_end' && objectValue(event.payload).isError === true,
  )
  assert.ok(failedEnds.length >= 5, 'every normalized failure must be recorded as a session tool error event')
  assert.equal(JSON.stringify(events).includes(MCP_FIXTURE_RAW_ERROR_MARKER), false)
})

// ─── Scenario: Connect to an approved MCP server (mcp-client-integration) ────

Given('a connector is approved for a project', async function (this: McpWorld) {
  const e2e = await ensureSignedIn(this)
  await upsertProjectMcpPolicy(e2e, { mcpPolicy: { allowedConnectors: ['github'] } })
})

When('the runtime creates an MCP client', async function (this: McpWorld) {
  const e2e = await createMcpSession(this, ['mcp:github'])
  const { state } = await connectGithubToFixture(this, `integration-secret-${e2e.runId}`)
  state.tools = await listConnectionTools(e2e, state.connection?.id)
  const result = await callConnectionTool(e2e, state.connection?.id, 'echo', e2e.latestSession?.id, {
    text: 'integration call',
  })
  state.callStatus = result.status
  state.callBody = result.body
})

Then('calls are authenticated, scoped, and recorded as session events', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  assert.equal(state.callStatus, 201)
  const toolCall = state.fixture?.recordedCalls().find((call) => call.method === 'tools/call')
  assert.ok(toolCall, 'fixture must have received the tool call')
  assert.equal(toolCall.authorization, `Bearer ${state.secretValue}`)

  const events = await sessionEvents(e2e)
  assert.ok(events.data.some((event) => event.type === 'tool_execution_end'))
  for (const event of events.data) {
    assert.equal(event.sessionId, e2e.latestSession?.id)
  }

  const otherPage = await openLocalPage()
  pagesToClose.push(otherPage)
  await authenticateE2EPage(otherPage)
  const crossTenantRead = await apiResponse(otherPage.request, `/api/v1/connections/${state.connection?.id}`)
  assert.equal(crossTenantRead.status(), 404)
})

// ─── Scenario: Reject unapproved MCP server use ──────────────────────────────

Given('a connector is not approved for the project or environment', async function (this: McpWorld) {
  const e2e = await ensureSignedIn(this)
  await connectGithubToFixture(this, `unapproved-secret-${e2e.runId}`)
  await upsertProjectMcpPolicy(e2e, { mcpPolicy: { allowedConnectors: ['linear'] } })
})

When('a session attempts to use the connector', async function (this: McpWorld) {
  const e2e = await createMcpSession(this, ['mcp:github'])
  const state = mcpState(this)
  state.fixtureRequestsBeforeAttempt = state.fixture?.requestCount() ?? 0
  const result = await callConnectionTool(e2e, state.connection?.id, 'repo.read', e2e.latestSession?.id, {
    repo: 'saltbo/any-managed-agents',
  })
  state.callStatus = result.status
  state.callBody = result.body
})

Then('AMA rejects the tool call before contacting the MCP server', function (this: McpWorld) {
  const state = mcpState(this)
  assert.equal(state.callStatus, 403)
  assert.equal(objectValue(state.callBody?.error).type, 'policy_denied')
  assert.equal(
    state.fixture?.requestCount(),
    state.fixtureRequestsBeforeAttempt,
    'the MCP server must not receive any request for a rejected call',
  )
})

Then('records a policy event on the session', async function (this: McpWorld) {
  const e2e = this.e2e
  assert.ok(e2e, 'e2e state must exist')
  const events = await sessionEvents(e2e)
  const policy = events.data.find(
    (event) => event.type === 'policy.decision' && objectValue(event.payload).allowed === false,
  )
  assert.ok(policy, 'expected a denied policy.decision event on the session')
  assert.equal(objectValue(policy.payload).connectorId, 'github')
  const audit = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    '/api/v1/audit-records?action=connection_tool.call&limit=20',
  )
  assert.ok(audit.data.some((record) => record.outcome === 'denied' && record.sessionId === e2e.latestSession?.id))
})

// ─── Scenario: Refresh connector credentials for runtime ─────────────────────

Given('a connector credential has been rotated', async function (this: McpWorld) {
  const e2e = await createMcpSession(this, ['mcp:github'])
  const { state } = await connectGithubToFixture(this, `initial-secret-${e2e.runId}`)
  state.tools = await listConnectionTools(e2e, state.connection?.id)
  state.originalConnectedAt = String(state.connection?.connectedAt)

  // Prove the original credential version works before rotating it.
  const initialCall = await callConnectionTool(e2e, state.connection?.id, 'echo', e2e.latestSession?.id, {
    text: 'pre-rotation call',
  })
  assert.equal(initialCall.status, 201)

  state.rotatedSecretValue = `rotated-secret-${e2e.runId}`
  await apiJson<Json>(
    e2e.page.request,
    `/api/v1/vaults/${state.vault?.id}/credentials/${state.credential?.id}/versions`,
    {
      method: 'POST',
      data: { provider: 'cloudflare-secrets', secretValue: state.rotatedSecretValue },
    },
  )
  state.fixture?.setAcceptedTokens([state.rotatedSecretValue])
})

When('a new session starts', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  state.rotatedSession = await createSession(e2e)
})

Then('the runtime resolves the latest allowed credential version', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  const result = await callConnectionTool(e2e, state.connection?.id, 'echo', state.rotatedSession?.id, {
    text: 'post-rotation call',
  })
  assert.equal(result.status, 201, `post-rotation call failed: ${JSON.stringify(result.body)}`)
  const lastToolCall = state.fixture
    ?.recordedCalls()
    .filter((call) => call.method === 'tools/call')
    .at(-1)
  assert.ok(lastToolCall, 'fixture must have received the post-rotation call')
  assert.equal(lastToolCall.authorization, `Bearer ${state.rotatedSecretValue}`)
})

Then(
  'existing sessions keep their original safe credential reference until they stop or reconnect according to policy',
  async function (this: McpWorld) {
    const e2e = this.e2e
    const state = mcpState(this)
    assert.ok(e2e, 'e2e state must exist')
    // The rotation did not force a reconnect: the connection record and the
    // original session are unchanged, and only safe references are stored.
    const connection = await apiJson<Json>(e2e.page.request, `/api/v1/connections/${state.connection?.id}`)
    assert.equal(connection.state, 'connected')
    assert.equal(connection.connectedAt, state.originalConnectedAt)
    assert.ok(objectValue(connection.credentialRef).credentialId, 'connection keeps a safe credential reference')
    const serializedConnection = JSON.stringify(connection)
    assert.equal(serializedConnection.includes(String(state.secretValue)), false)
    assert.equal(serializedConnection.includes(String(state.rotatedSecretValue)), false)

    const originalSession = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
    assert.equal(originalSession.state, 'idle', 'the original session must keep running across rotation')
    const events = await sessionEvents(e2e)
    const eventsJson = JSON.stringify(events)
    assert.equal(eventsJson.includes(String(state.secretValue)), false)
    assert.equal(eventsJson.includes(String(state.rotatedSecretValue)), false)
  },
)

// ─── Scenario: Enforce MCP call rules (engine-mcp.feature) ───────────────────

When('an agent attempts an MCP operation', async function (this: McpWorld) {
  const e2e = await createMcpSession(this, ['mcp:github'])
  const { state } = await connectGithubToFixture(this, `engine-secret-${e2e.runId}`)
  state.tools = await listConnectionTools(e2e, state.connection?.id)

  await upsertProjectMcpPolicy(e2e, { mcpPolicy: { allowedConnectors: ['linear'] } })
  state.fixtureRequestsBeforeAttempt = state.fixture?.requestCount() ?? 0
  const denied = await callConnectionTool(e2e, state.connection?.id, 'echo', e2e.latestSession?.id, {
    text: 'blocked attempt',
  })
  state.deniedStatus = denied.status
  state.deniedBody = denied.body
  state.fixtureRequestsAfterDeniedAttempt = state.fixture?.requestCount() ?? 0

  await upsertProjectMcpPolicy(e2e, { mcpPolicy: { allowedConnectors: ['github', 'linear'] } })
  const allowed = await callConnectionTool(e2e, state.connection?.id, 'echo', e2e.latestSession?.id, {
    text: 'allowed attempt',
  })
  state.allowedStatus = allowed.status
  state.allowedBody = allowed.body
})

Then('the runtime checks connector policy before executing the call', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  assert.equal(state.deniedStatus, 403)
  assert.equal(objectValue(state.deniedBody?.error).type, 'policy_denied')
  assert.equal(
    state.fixtureRequestsAfterDeniedAttempt,
    state.fixtureRequestsBeforeAttempt,
    'the denied attempt must not reach the MCP server',
  )

  assert.equal(state.allowedStatus, 201)
  assert.ok(
    (state.fixture?.recordedCalls() ?? []).some((call) => call.method === 'tools/call'),
    'the allowed call must reach the MCP server after the policy check passes',
  )

  const audit = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    '/api/v1/audit-records?action=connection_tool.call&limit=20',
  )
  assert.ok(audit.data.some((record) => record.outcome === 'denied'))
  assert.ok(audit.data.some((record) => record.outcome === 'success'))
})

// ─── Scenario: Execute an approved MCP call (engine-mcp-e2e.feature) ─────────

Given('an agent has access to an approved MCP connector', async function (this: McpWorld) {
  const e2e = await ensureSignedIn(this)
  await upsertProjectMcpPolicy(e2e, { mcpPolicy: { allowedConnectors: ['github'] } })
  await createMcpSession(this, ['mcp:github'])
  const { state } = await connectGithubToFixture(this, `engine-e2e-secret-${e2e.runId}`)
  state.tools = await listConnectionTools(e2e, state.connection?.id)
})

When('the agent calls the connector during a session', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  const result = await callConnectionTool(e2e, state.connection?.id, 'add', e2e.latestSession?.id, { a: 19, b: 23 })
  state.callStatus = result.status
  state.callBody = result.body
})

Then('the result is streamed, recorded, and scoped to the project', async function (this: McpWorld) {
  const e2e = this.e2e
  const state = mcpState(this)
  assert.ok(e2e, 'e2e state must exist')
  assert.equal(state.callStatus, 201)
  assert.equal(objectValue(objectValue(state.callBody?.output).structuredContent).sum, 42)

  const events = await sessionEvents(e2e)
  const end = events.data.find(
    (event) => event.type === 'tool_execution_end' && objectValue(event.payload).isError === false,
  )
  assert.ok(end, 'expected the call result to be recorded as a session event')
  assert.equal(objectValue(end.payload).toolName, 'add')

  const otherPage = await openLocalPage()
  pagesToClose.push(otherPage)
  await authenticateE2EPage(otherPage)
  const crossTenantEvents = await apiResponse(otherPage.request, `/api/v1/sessions/${e2e.latestSession?.id}/events`)
  assert.equal(crossTenantEvents.status(), 404)
})
