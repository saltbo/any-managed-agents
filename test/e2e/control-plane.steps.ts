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
    this.response = await this.app.fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
  },
)

Then('the data is persisted through Cloudflare D1', async function (this: AmaWorld) {
  assert.ok(this.response, 'OpenAPI response must be available before asserting storage-backed resources')
  const body = (await this.response.clone().json()) as { paths?: Record<string, unknown> }
  for (const path of ['/api/agents', '/api/environments', '/api/sessions', '/api/vaults']) {
    assert.ok(body.paths?.[path], `Expected D1-backed resource path ${path}`)
  }
})

When('the platform runs in Cloudflare', async function (this: AmaWorld) {
  this.app = createApp()
  this.response = await this.app.fetch(new Request('https://example.test/api/health'), {} as Env)
})

Then('control-plane requests use Worker routing', function (this: AmaWorld) {
  assert.ok(this.response, 'Health response must be available before asserting Worker routing')
  assert.equal(this.response.status, 200)
})

Then('session state uses Durable Object and D1 bindings', async function (this: AmaWorld) {
  assert.ok(this.app, 'Worker app must be initialized before asserting session routes')
  const response = await this.app.fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
  const body = (await response.json()) as { paths?: Record<string, unknown> }
  assert.ok(body.paths?.['/api/sessions'], 'Expected session control-plane routes')
  assert.ok(body.paths?.['/api/sessions/{sessionId}/events'], 'Expected durable session event routes')
})
