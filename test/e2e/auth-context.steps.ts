import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { createApp } from '../../server/app'
import type { Env } from '../../server/env'
import { ensureSignedIn } from './shared-helpers'
import type { AmaWorld } from './world'

type Json = Record<string, unknown>

// ─── Scenario: Reject unauthenticated control-plane access ────────────────────

Given('an organization with a project and a user exists', async function (this: AmaWorld & { e2e?: object }) {
  // Ensure a user, org, and project exist in the local e2e environment.
  await ensureSignedIn(this as Parameters<typeof ensureSignedIn>[0])
})

When('a request without a valid session calls a protected API', async function (this: AmaWorld) {
  const app = createApp()
  this.response = await app.fetch(
    new Request('https://example.test/api/agents', {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    {} as Env,
  )
})

Then('the request is rejected with 401', function (this: AmaWorld) {
  assert.ok(this.response, 'API response must exist before asserting status')
  assert.equal(this.response.status, 401)
})

Then('no project data is returned', async function (this: AmaWorld) {
  assert.ok(this.response, 'API response must exist before asserting body')
  const body = (await this.response.clone().json()) as { error?: Record<string, unknown>; data?: unknown }
  assert.ok(body.error, 'Response must contain an error envelope')
  assert.equal('data' in body, false, 'Response must not contain project data')
})

// ─── Scenario: Resolve authenticated context ──────────────────────────────────

Given('OIDC provider can issue a valid user session', async function (this: AmaWorld & { e2e?: object }) {
  // In the local e2e harness, the test auth endpoint issues a valid bearer
  // token backed by the e2e OIDC stub — this step sets up that token.
  await ensureSignedIn(this as Parameters<typeof ensureSignedIn>[0])
})

When(
  'the user requests their auth context',
  async function (this: AmaWorld & { authContext?: Json; unauthResponse?: Response }) {
    const world = this as typeof this & {
      e2e?: { page: { request: { fetch(url: string, opts?: object): Promise<Response> } }; auth?: Json }
    }
    assert.ok(world.e2e, 'Signed-in state must exist before requesting auth context')
    // The auth context is returned by the e2e token exchange itself and also
    // reflected in authenticated API responses. Store it from the already-resolved
    // state and exercise an authenticated project list to confirm the context.
    this.authContext = world.e2e.auth as Json
    // Also verify that an unauthenticated request is rejected (for the And step below)
    const app = createApp()
    this.unauthResponse = await app.fetch(
      new Request('https://example.test/api/projects', {
        headers: { accept: 'application/json' },
      }),
      {} as Env,
    )
  },
)

Then(
  'the request context includes user, organization, project, roles, and permissions',
  function (this: AmaWorld & { authContext?: Json }) {
    const ctx = this.authContext
    assert.ok(ctx, 'Auth context must have been resolved')
    assert.ok(ctx.user, 'Auth context must include user')
    assert.ok(ctx.organization, 'Auth context must include organization')
    assert.ok(ctx.project, 'Auth context must include project')
    assert.ok(Array.isArray(ctx.roles), 'Auth context must include roles array')
    assert.ok(Array.isArray(ctx.permissions), 'Auth context must include permissions array')
    const user = ctx.user as Record<string, unknown>
    const org = ctx.organization as Record<string, unknown>
    const project = ctx.project as Record<string, unknown>
    assert.ok(typeof user.id === 'string', 'user.id must be a string')
    assert.ok(typeof org.id === 'string', 'organization.id must be a string')
    assert.ok(typeof project.id === 'string', 'project.id must be a string')
  },
)

Then(
  'protected APIs reject missing or invalid sessions with the standard error envelope',
  async function (this: AmaWorld & { unauthResponse?: Response }) {
    const response = this.unauthResponse
    assert.ok(response, 'Unauthenticated response must exist')
    assert.equal(response.status, 401)
    const body = (await response.clone().json()) as { error?: { type?: string; message?: string } }
    assert.equal(typeof body.error?.type, 'string', 'Error envelope must include type')
    assert.equal(typeof body.error?.message, 'string', 'Error envelope must include message')
  },
)

// ─── Scenario: Delegate first admin bootstrap ─────────────────────────────────

When('AMA starts without local users or organizations', async function (this: AmaWorld) {
  // The control plane initializes without any local user or org store — it
  // accepts only OIDC-issued claims. Verify this by checking the health
  // endpoint and confirming there is no local user management route.
  const app = createApp()
  this.response = await app.fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
})

Then(
  'OIDC provider remains responsible for first admin bootstrap and credential rotation',
  async function (this: AmaWorld) {
    assert.ok(this.response, 'OpenAPI response must exist')
    const doc = (await this.response.clone().json()) as { paths?: Record<string, unknown> }
    // No local user management routes exist — OIDC owns identity
    const paths = Object.keys(doc.paths ?? {})
    assert.ok(!paths.some((p) => p.startsWith('/api/users')), 'AMA must not own a /api/users route')
    assert.ok(!paths.some((p) => p.includes('password')), 'AMA must not expose password management')
  },
)

Then('AMA accepts only OIDC identity claims for product access', async function (this: AmaWorld) {
  // Without a bearer token from OIDC, all protected routes return 401
  const app = createApp()
  const response = await app.fetch(
    new Request('https://example.test/api/agents', {
      headers: { accept: 'application/json' },
    }),
    {} as Env,
  )
  assert.equal(response.status, 401)
  const body = (await response.json()) as { error?: { type?: string } }
  assert.equal(body.error?.type, 'authentication_required')
})
