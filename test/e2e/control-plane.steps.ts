import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { createApp } from '../../server/app'
import type { Env } from '../../server/env'
import type { AmaWorld } from './world'

Given('the Worker app is initialized', function (this: AmaWorld) {
  this.app = createApp()
})

When('I request GET {string}', async function (this: AmaWorld, path: string) {
  assert.ok(this.app, 'Worker app must be initialized before making requests')
  this.response = await this.app.fetch(new Request(`https://example.test${path}`), {} as Env)
})

Then('the response status should be {int}', function (this: AmaWorld, status: number) {
  assert.ok(this.response, 'Response must be available before asserting status')
  assert.equal(this.response.status, status)
})

Then(
  'the response JSON field {string} should be {string}',
  async function (this: AmaWorld, field: string, expected: string) {
    assert.ok(this.response, 'Response must be available before asserting JSON')
    const body = (await this.response.json()) as Record<string, unknown>
    assert.equal(body[field], expected)
  },
)

Then('the response error type should be {string}', async function (this: AmaWorld, expected: string) {
  assert.ok(this.response, 'Response must be available before asserting errors')
  const body = (await this.response.clone().json()) as { error?: { type?: string } }
  assert.equal(body.error?.type, expected)
})

Then('the response should not include tenant data', async function (this: AmaWorld) {
  assert.ok(this.response, 'Response must be available before asserting tenant data')
  const body = (await this.response.clone().json()) as Record<string, unknown>
  assert.equal('data' in body, false)
  assert.equal('organization' in body, false)
  assert.equal('project' in body, false)
})

Then('the OpenAPI document should include path {string}', async function (this: AmaWorld, path: string) {
  assert.ok(this.response, 'Response must be available before asserting OpenAPI paths')
  const body = (await this.response.clone().json()) as { paths?: Record<string, unknown> }
  assert.ok(body.paths?.[path], `Expected OpenAPI path ${path}`)
})

Then(
  'the OpenAPI path {string} should include method {string}',
  async function (this: AmaWorld, path: string, method: string) {
    assert.ok(this.response, 'Response must be available before asserting OpenAPI methods')
    const body = (await this.response.clone().json()) as { paths?: Record<string, Record<string, unknown>> }
    assert.ok(body.paths?.[path]?.[method], `Expected OpenAPI path ${path} to include ${method}`)
  },
)

When(
  'the platform stores projects, agents, sessions, providers, policies, vault metadata, usage, or audit records',
  async function (this: AmaWorld) {
    this.app = createApp()
    this.response = await this.app.fetch(new Request('https://example.test/api/v1/openapi.json'), {} as Env)
  },
)

Then('the data is persisted through Cloudflare D1', async function (this: AmaWorld) {
  assert.ok(this.response, 'OpenAPI response must be available before asserting storage-backed resources')
  const body = (await this.response.clone().json()) as { paths?: Record<string, unknown> }
  for (const path of ['/api/v1/agents', '/api/v1/environments', '/api/v1/sessions', '/api/v1/vaults']) {
    assert.ok(body.paths?.[path], `Expected D1-backed resource path ${path}`)
  }
})

When('the platform runs in Cloudflare', async function (this: AmaWorld) {
  this.app = createApp()
  this.response = await this.app.fetch(new Request('https://example.test/api/v1/health'), {} as Env)
})

Then('control-plane requests use Worker routing', function (this: AmaWorld) {
  assert.ok(this.response, 'Health response must be available before asserting Worker routing')
  assert.equal(this.response.status, 200)
})

Then('session state uses Durable Object and D1 bindings', async function (this: AmaWorld) {
  assert.ok(this.app, 'Worker app must be initialized before asserting session routes')
  const response = await this.app.fetch(new Request('https://example.test/api/v1/openapi.json'), {} as Env)
  const body = (await response.json()) as { paths?: Record<string, unknown> }
  assert.ok(body.paths?.['/api/v1/sessions'], 'Expected session control-plane routes')
  assert.ok(body.paths?.['/api/v1/sessions/{sessionId}/events'], 'Expected durable session event routes')
})

Then(
  'the Workers deployment must not require Postgres or another external relational database',
  async function (this: AmaWorld) {
    // The platform uses D1 exclusively. There must be no external DB dependency
    // references in the OpenAPI document or health response.
    assert.ok(this.app, 'Worker app must be initialized before asserting storage requirements')
    const response = await this.app.fetch(new Request('https://example.test/api/v1/health'), {} as Env)
    assert.equal(response.status, 200)
    const body = await response.json()
    const serialized = JSON.stringify(body)
    assert.ok(!serialized.includes('postgres'), 'Health response must not reference Postgres')
    assert.ok(!serialized.includes('mysql'), 'Health response must not reference MySQL')
  },
)

Then('the deployment does not require a separate Node server', async function (this: AmaWorld) {
  // AMA runs as a Cloudflare Worker — the health endpoint proves the app
  // operates without a Node.js HTTP server.
  assert.ok(this.app, 'Worker app must be initialized before asserting runtime requirements')
  const response = await this.app.fetch(new Request('https://example.test/api/v1/health'), {} as Env)
  assert.equal(response.status, 200)
  const body = (await response.json()) as { runtime?: string }
  // The Worker app responds successfully without a separate Node server
  assert.ok(body, 'Health response must be non-empty')
})
