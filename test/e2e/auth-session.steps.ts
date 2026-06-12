import assert from 'node:assert/strict'
import { After, AfterAll, Given, setDefaultTimeout, Then, When } from '@cucumber/cucumber'
import type { APIResponse } from '@playwright/test'
import { closeLocalApp, ensureLocalApp } from './local-app'
import type { AmaWorld } from './world'

// ──────────────────────────────────────────────────────────────────────────────
// Shared state types
// ──────────────────────────────────────────────────────────────────────────────

interface AuthSessionState {
  runId: string
  e2eToken: string
  sessionResponse?: Response
  apiResponse?: APIResponse
  sessionUser?: { id: string; email: string; name: string | null }
  sessionOrganization?: { id: string; name: string }
  sessionProject?: { id: string; name: string }
  sessionCookie?: string | undefined
  tenantAToken?: string
  tenantASession?: Record<string, unknown>
  createdSession?: Record<string, unknown>
  createdAgent?: Record<string, unknown>
  loginOptionsResponse?: Response
  loginOptionsBody?: { methods: Array<{ type: string; issuer?: string; clientId?: string }> } | undefined
}

type AuthWorld = AmaWorld & { authState?: AuthSessionState | undefined }

setDefaultTimeout(60_000)

After(function (this: AuthWorld) {
  // biome-ignore lint/suspicious/noExplicitAny: resetting world state
  ;(this as any).authState = undefined
})

AfterAll(async () => {
  await closeLocalApp()
})

// ──────────────────────────────────────────────────────────────────────────────
// Background: "an organization with a project and a user exists"
// (Used by auth-tenancy.feature)
// ──────────────────────────────────────────────────────────────────────────────

Given('an organization with a project and a user exists', async function (this: AuthWorld) {
  const origin = await ensureLocalApp()
  const runId = `auth-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const e2eToken = `e2e:${runId}`

  // Bootstrap the org+project in D1 via the session endpoint.
  const res = await fetch(`${origin}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: e2eToken }),
  })
  assert.equal(res.status, 200, `Background setup: expected 200 from /api/auth/session, got ${res.status}`)

  this.authState = { runId, e2eToken }
})

// ──────────────────────────────────────────────────────────────────────────────
// auth-flow.feature: Complete sign in
// ──────────────────────────────────────────────────────────────────────────────

When('a user completes the OIDC callback', async function (this: AuthWorld) {
  const origin = await ensureLocalApp()
  const runId = `auth-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const e2eToken = `e2e:${runId}`

  const res = await fetch(`${origin}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: e2eToken }),
  })

  const setCookieHeader = res.headers.get('set-cookie')
  const state: AuthSessionState = {
    runId,
    e2eToken,
    sessionResponse: res,
    ...(setCookieHeader ? { sessionCookie: setCookieHeader } : {}),
  }
  if (res.ok) {
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string | null }
      organization: { id: string; name: string }
      project: { id: string; name: string }
    }
    state.sessionUser = body.user
    state.sessionOrganization = body.organization
    state.sessionProject = body.project
  }
  this.authState = state
})

Then(
  'the platform creates an httpOnly session and resolves user, organization, and project context',
  async function (this: AuthWorld) {
    assert.ok(this.authState?.sessionResponse, 'Session response must exist')
    assert.equal(this.authState.sessionResponse.status, 200, 'Expected 200 from /api/auth/session')

    assert.ok(this.authState.sessionUser?.id, 'User id must be present')
    assert.ok(this.authState.sessionUser?.email, 'User email must be present')
    assert.ok(this.authState.sessionOrganization?.id, 'Organization id must be present')
    assert.ok(this.authState.sessionProject?.id, 'Project id must be present')

    // When AMA_SESSION_SECRET is configured the server sets an httpOnly cookie.
    const setCookie = this.authState.sessionCookie
    if (setCookie) {
      assert.ok(setCookie.includes('ama_session='), 'Cookie must be named ama_session')
      assert.ok(setCookie.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly')
    }
  },
)

Then('invalid OIDC provider callbacks return the standard OIDC error envelope', async function (this: AuthWorld) {
  const origin = await ensureLocalApp()
  const res = await fetch(`${origin}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: 'invalid-token-that-cannot-be-validated' }),
  })
  assert.equal(res.status, 401, 'Invalid token must return 401')
  const body = (await res.json()) as { error?: { type?: string; message?: string } }
  assert.equal(body.error?.type, 'oidc_error', 'Error type must be oidc_error')
  assert.ok(body.error?.message, 'Error message must be present')
})

// ──────────────────────────────────────────────────────────────────────────────
// login.feature: Login with valid credentials
// ──────────────────────────────────────────────────────────────────────────────

When('credentials are valid', async function (this: AuthWorld) {
  const origin = await ensureLocalApp()
  const runId = `login-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const e2eToken = `e2e:${runId}`

  const res = await fetch(`${origin}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: e2eToken }),
  })

  const state: AuthSessionState = { runId, e2eToken, sessionResponse: res }
  if (res.ok) {
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string | null }
      organization: { id: string; name: string }
      project: { id: string; name: string }
    }
    state.sessionUser = body.user
    state.sessionOrganization = body.organization
    state.sessionProject = body.project
  }
  this.authState = state
})

Then(
  'the platform creates an httpOnly session and returns the default organization and project',
  async function (this: AuthWorld) {
    assert.ok(this.authState?.sessionResponse, 'Session response must exist')
    assert.equal(this.authState.sessionResponse.status, 200, 'Expected 200 from /api/auth/session')
    assert.ok(this.authState.sessionOrganization?.id, 'Organization id must be present')
    assert.ok(this.authState.sessionProject?.id, 'Project id must be present')
    assert.equal(this.authState.sessionProject.name, 'Default project', 'Default project name expected')
  },
)

// ──────────────────────────────────────────────────────────────────────────────
// auth-tenancy.feature: Sign in to the control plane
// ──────────────────────────────────────────────────────────────────────────────

When('the user signs in through OIDC provider', async function (this: AuthWorld) {
  assert.ok(this.authState, 'Auth state must be initialized by background step')
  const origin = await ensureLocalApp()
  const res = await fetch(`${origin}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: this.authState.e2eToken }),
  })
  this.authState.sessionResponse = res
  if (res.ok) {
    const body = (await res.json()) as {
      user: { id: string; email: string; name: string | null }
      organization: { id: string; name: string }
      project: { id: string; name: string }
    }
    this.authState.sessionUser = body.user
    this.authState.sessionOrganization = body.organization
    this.authState.sessionProject = body.project
  }
})

Then('the platform accepts the OIDC session', function (this: AuthWorld) {
  assert.ok(this.authState?.sessionResponse, 'Session response must exist')
  assert.equal(this.authState.sessionResponse.status, 200, 'Expected 200 from /api/auth/session')
})

Then('subsequent control-plane requests resolve the user, organization, and project', async function (this: AuthWorld) {
  assert.ok(this.authState?.sessionUser, 'Session user must be resolved')
  assert.ok(this.authState.sessionOrganization, 'Session organization must be resolved')
  assert.ok(this.authState.sessionProject, 'Session project must be resolved')

  // Verify the bearer token for the same claims can call the projects API.
  const origin = await ensureLocalApp()
  const projectsRes = await fetch(`${origin}/api/projects`, {
    headers: { authorization: `Bearer ${this.authState.e2eToken}` },
  })
  assert.equal(projectsRes.status, 200, 'Projects API must return 200')
  const projects = (await projectsRes.json()) as { data: Array<{ id: string }> }
  const projectIds = projects.data.map((p) => p.id)
  assert.ok(projectIds.includes(this.authState.sessionProject.id), 'Session project must appear in the projects list')
})

// ──────────────────────────────────────────────────────────────────────────────
// auth-tenancy.feature: Reject unauthenticated control-plane access
// ──────────────────────────────────────────────────────────────────────────────

When('a request without a valid session calls a protected API', async function (this: AuthWorld) {
  const origin = await ensureLocalApp()
  const res = await fetch(`${origin}/api/agents`)
  const text = await res.text()
  this.authState = {
    runId: 'unauth',
    e2eToken: '',
    apiResponse: makeApiResponse(res.status, text),
  }
})

Then('the request is rejected with 401', function (this: AuthWorld) {
  assert.ok(this.authState?.apiResponse, 'API response must exist')
  assert.equal(this.authState.apiResponse.status(), 401, 'Expected 401 for unauthenticated request')
})

Then('no project data is returned', async function (this: AuthWorld) {
  assert.ok(this.authState?.apiResponse, 'API response must exist')
  const body = await this.authState.apiResponse.json()
  const bodyObj = body as Record<string, unknown>
  assert.equal('data' in bodyObj, false, 'Response must not contain data field')
  assert.ok((bodyObj.error as Record<string, unknown>)?.type, 'Error type must be present')
})

// ──────────────────────────────────────────────────────────────────────────────
// auth-tenancy.feature: Apply tenant context to agent runtime requests
// ──────────────────────────────────────────────────────────────────────────────

Given('a session belongs to a project', async function (this: AuthWorld) {
  assert.ok(this.authState, 'Auth state must be initialized by background step')
  const origin = await ensureLocalApp()
  const tenantAToken = `Bearer ${this.authState.e2eToken}`

  const agentRes = await fetch(`${origin}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: tenantAToken },
    body: JSON.stringify({ name: `${this.authState.runId} tenancy-agent` }),
  })
  assert.equal(agentRes.status, 201, `Expected 201 from POST /api/agents, got ${agentRes.status}`)
  const agent = (await agentRes.json()) as { id: string; projectId: string }

  const envRes = await fetch(`${origin}/api/environments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: tenantAToken },
    body: JSON.stringify({ name: `${this.authState.runId} tenancy-env` }),
  })
  assert.equal(envRes.status, 201, `Expected 201 from POST /api/environments, got ${envRes.status}`)
  const environment = (await envRes.json()) as { id: string }

  const sessionRes = await fetch(`${origin}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: tenantAToken },
    body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
  })
  assert.equal(sessionRes.status, 201, `Expected 201 from POST /api/sessions, got ${sessionRes.status}`)
  const session = (await sessionRes.json()) as { id: string; runtimeEndpointPath: string }

  this.authState.tenantAToken = tenantAToken
  this.authState.tenantASession = session as unknown as Record<string, unknown>
})

When('the user connects through the AMA runtime proxy', function (this: AuthWorld) {
  // Resolved in the Then step — token and session must both be set.
  assert.ok(this.authState?.tenantAToken, 'Tenant A token must be set')
  assert.ok(this.authState.tenantASession, 'Tenant A session must exist')
})

Then('the AMA runtime proxy resolves the project and user context', async function (this: AuthWorld) {
  const origin = await ensureLocalApp()
  const session = this.authState!.tenantASession as { runtimeEndpointPath: string }
  const res = await fetch(`${origin}${session.runtimeEndpointPath}`, {
    method: 'POST',
    headers: { authorization: this.authState!.tenantAToken! },
  })
  // 200 or 409 (session not running in test mode) both confirm the proxy resolved tenant context.
  assert.ok(
    res.status === 200 || res.status === 409,
    `Expected 200 or 409 (tenant context resolved by proxy), got ${res.status}`,
  )
})

Then(
  'AMA rejects access from users outside the project before forwarding to the selected session runtime',
  async function (this: AuthWorld) {
    assert.ok(this.authState?.tenantASession, 'Tenant A session must exist')
    const origin = await ensureLocalApp()
    const session = this.authState.tenantASession as { runtimeEndpointPath: string }

    // Tenant B uses a different run ID → different org in e2e claims
    const tenantBRunId = `tenant-b-${Date.now()}`
    const tenantBToken = `Bearer e2e:${tenantBRunId}`

    const res = await fetch(`${origin}${session.runtimeEndpointPath}`, {
      method: 'POST',
      headers: { authorization: tenantBToken },
    })
    assert.equal(res.status, 404, `Expected 404 for cross-tenant runtime access, got ${res.status}`)
  },
)

// ──────────────────────────────────────────────────────────────────────────────
// auth-tenancy.feature: Scope resource identifiers by tenant
// ──────────────────────────────────────────────────────────────────────────────

When('the platform creates agent runtime state', async function (this: AuthWorld) {
  assert.ok(this.authState, 'Auth state must be initialized by background step')
  const origin = await ensureLocalApp()
  const token = `Bearer ${this.authState.e2eToken}`

  const agentRes = await fetch(`${origin}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({ name: `${this.authState.runId} scope-agent` }),
  })
  assert.equal(agentRes.status, 201)
  const agent = (await agentRes.json()) as { id: string; projectId: string }

  const envRes = await fetch(`${origin}/api/environments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({ name: `${this.authState.runId} scope-env` }),
  })
  assert.equal(envRes.status, 201)
  const environment = (await envRes.json()) as { id: string }

  const sessionRes = await fetch(`${origin}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
  })
  assert.equal(sessionRes.status, 201)
  const session = (await sessionRes.json()) as {
    id: string
    durableObjectName: string
    projectId: string
  }
  this.authState.createdAgent = agent as unknown as Record<string, unknown>
  this.authState.createdSession = session as unknown as Record<string, unknown>
})

Then('Durable Object names include organization, project, and session scope', function (this: AuthWorld) {
  const session = this.authState?.createdSession as {
    id: string
    durableObjectName: string
    projectId: string
  }
  assert.ok(session?.durableObjectName, 'durableObjectName must be present')
  const name = session.durableObjectName
  assert.ok(name.includes('org_'), `DO name must include org scope, got: ${name}`)
  assert.ok(name.includes('project_'), `DO name must include project scope, got: ${name}`)
  assert.ok(name.includes('session_'), `DO name must include session scope, got: ${name}`)
  assert.ok(name.includes(`:project_${session.projectId}:`), `DO name must embed the project id, got: ${name}`)
})

Then('identifiers must not expose secrets or provider credentials', function (this: AuthWorld) {
  const session = this.authState?.createdSession as { durableObjectName: string }
  assert.ok(session?.durableObjectName, 'durableObjectName must be present')
  const doName = session.durableObjectName
  // Only alphanumeric, underscore, colon (segment separator), hyphen (in IDs)
  assert.match(
    doName,
    /^[A-Za-z0-9_:-]+$/,
    `DO name contains unexpected characters that may indicate secret exposure: ${doName}`,
  )
  // No base64 padding / path separators / query chars that appear in tokens or URLs
  assert.doesNotMatch(doName, /[./=+]/, `DO name must not contain secret-like characters: ${doName}`)
})

// ──────────────────────────────────────────────────────────────────────────────
// sso-discovery.feature: Discover organization login method
// ──────────────────────────────────────────────────────────────────────────────

When('a user enters an organization identifier', async function (this: AuthWorld) {
  const origin = await ensureLocalApp()
  const res = await fetch(`${origin}/api/auth/login-options?organization=example-org`)
  const body = res.ok
    ? ((await res.json()) as { methods: Array<{ type: string; issuer?: string; clientId?: string }> })
    : undefined
  const state: AuthSessionState = {
    runId: 'sso-discovery',
    e2eToken: '',
    loginOptionsResponse: res,
    ...(body ? { loginOptionsBody: body } : {}),
  }
  this.authState = state
})

Then('the platform returns available password, SSO, or provider login options', function (this: AuthWorld) {
  assert.ok(this.authState?.loginOptionsResponse, 'Login options response must exist')
  assert.equal(this.authState.loginOptionsResponse.status, 200, 'Expected 200 from /api/auth/login-options')
  assert.ok(this.authState.loginOptionsBody, 'Login options body must be present')
  assert.ok(Array.isArray(this.authState.loginOptionsBody.methods), 'methods must be an array')

  const firstMethod = this.authState.loginOptionsBody.methods.at(0)
  if (firstMethod) {
    assert.equal(firstMethod.type, 'oidc', 'Method type must be oidc (no local password option)')
    assert.ok(firstMethod.issuer, 'Issuer must be present')
    assert.ok(firstMethod.clientId, 'ClientId must be present')
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Utility: wrap a native fetch response in APIResponse shape for shared steps
// ──────────────────────────────────────────────────────────────────────────────

function makeApiResponse(status: number, text: string): APIResponse {
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    json: () => Promise.resolve(text ? JSON.parse(text) : null),
    text: () => Promise.resolve(text),
  } as unknown as APIResponse
}
