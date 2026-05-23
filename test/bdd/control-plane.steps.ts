import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { createApp } from '../../server/app'
import type { Env } from '../../server/env'

let app: ReturnType<typeof createApp>
let response: Response

Given('the Worker app is initialized', () => {
  app = createApp()
})

When('I request GET {string}', async (path: string) => {
  response = await app.fetch(new Request(`https://example.test${path}`), {} as Env)
})

Then('the response status should be {int}', (status: number) => {
  assert.equal(response.status, status)
})

Then('the response JSON field {string} should be {string}', async (field: string, expected: string) => {
  const body = (await response.json()) as Record<string, unknown>
  assert.equal(body[field], expected)
})

Then('the response error type should be {string}', async (expected: string) => {
  const body = (await response.clone().json()) as { error?: { type?: string } }
  assert.equal(body.error?.type, expected)
})

Then('the response should not include tenant data', async () => {
  const body = (await response.clone().json()) as Record<string, unknown>
  assert.equal('data' in body, false)
  assert.equal('organization' in body, false)
  assert.equal('project' in body, false)
})

Then('the OpenAPI document should include path {string}', async (path: string) => {
  const body = (await response.clone().json()) as { paths?: Record<string, unknown> }
  assert.ok(body.paths?.[path], `Expected OpenAPI path ${path}`)
})
