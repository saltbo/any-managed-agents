import assert from 'node:assert/strict'
import { After, Given, Then, When } from '@cucumber/cucumber'
import { createApp } from '../../server/app'
import type { Env } from '../../server/env'
import { createRestishOpenApiHarness } from './restish-openapi'
import type { AmaWorld } from './world'

type OpenApiOperation = {
  operationId?: string
  summary?: string
  tags?: string[]
  parameters?: unknown[]
  requestBody?: unknown
  responses?: Record<string, unknown>
  security?: Array<Record<string, string[]>>
}

type OpenApiDocument = {
  openapi?: string
  paths?: Record<string, Record<string, OpenApiOperation>>
  components?: {
    securitySchemes?: Record<string, unknown>
    schemas?: Record<string, unknown>
  }
}

After({ tags: '@cli or @openapi' }, async function (this: AmaWorld) {
  await this.restishHarness?.close()
  this.restishHarness = undefined
  this.restishDiscovery = undefined
  this.restishWorkflow = undefined
  this.restishJsonOutput = undefined
  this.openApiDocument = undefined
})

Given('a local AMA control-plane harness is running', async function (this: AmaWorld) {
  this.restishHarness = await createRestishOpenApiHarness()
})

Given(/^the platform exposes control-plane APIs under \/api$/, function (this: AmaWorld) {
  this.app = createApp()
})

When(/^CI configures restish with \/api\/openapi\.json$/, async function (this: AmaWorld) {
  const harness = await ensureRestishHarness(this)
  this.restishDiscovery = await harness.discover()
})

When(
  'CI uses restish to send unauthenticated create environment, create agent, and create session requests',
  async function (this: AmaWorld) {
    const harness = await ensureRestishHarness(this)
    this.restishWorkflow = await harness.createResourceWorkflow()
  },
)

When('a developer requests the OpenAPI document', async function (this: AmaWorld) {
  await requestOpenApiDocument(this)
})

When(
  'an API request fails validation, authentication, authorization, policy, or runtime checks',
  async function (this: AmaWorld) {
    const app = createApp()
    this.response = await app.fetch(
      new Request('https://example.test/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
      {} as Env,
    )
  },
)

Then('restish can discover the core health, environment, agent, and session operations', function (this: AmaWorld) {
  assert.ok(this.restishDiscovery, 'Restish discovery must run before asserting discovered operations')
  assert.equal(this.restishDiscovery.healthName, 'Any Managed Agents')
  for (const command of [
    'create-agent',
    'create-environment',
    'create-session',
    'get-health',
    'list-agents',
    'list-environments',
    'list-sessions',
  ]) {
    assert.ok(this.restishDiscovery.commands.includes(command), `Expected restish to discover ${command}`)
  }
})

Then('restish receives the platform standard authentication error envelope', function (this: AmaWorld) {
  assert.ok(this.restishWorkflow, 'Restish resource workflow must run before asserting resource results')
  assert.equal(this.restishWorkflow.environmentErrorType, 'authentication_required')
  assert.equal(this.restishWorkflow.agentErrorType, 'authentication_required')
  assert.equal(this.restishWorkflow.sessionErrorType, 'authentication_required')
})

Then(
  'the document describes control-plane resources, request bodies, responses, and error shapes',
  function (this: AmaWorld) {
    assertControlPlaneOperationsHaveMetadata(this)
    assert.ok(openApiDocument(this).components?.schemas?.ErrorResponse)
  },
)

Then(
  'the document is generated from Hono route schemas instead of hand-written OpenAPI JSON',
  function (this: AmaWorld) {
    assert.ok(Object.keys(openApiDocument(this).paths ?? {}).length > 0)
  },
)

Then('it does not describe a custom replacement for AMA session traffic', function (this: AmaWorld) {
  const runtimePaths = Object.keys(openApiDocument(this).paths ?? {}).filter((path) => path.startsWith('/runtime/'))
  assert.deepEqual(runtimePaths, [])
})

Then('the response uses a stable error envelope', async function (this: AmaWorld) {
  assert.ok(this.response, 'API error response must exist before asserting envelope')
  assert.equal(this.response.status, 400)
  const body = (await this.response.clone().json()) as { error?: Record<string, unknown> }
  assert.equal(body.error?.type, 'validation_error')
  assert.equal(body.error?.message, 'Invalid request')
})

Then('the envelope includes type, message, and safe structured details', async function (this: AmaWorld) {
  assert.ok(this.response, 'API error response must exist before asserting details')
  const body = (await this.response.clone().json()) as { error?: Record<string, unknown> }
  assert.equal(typeof body.error?.type, 'string')
  assert.equal(typeof body.error?.message, 'string')
  assert.ok(body.error?.details === undefined || typeof body.error.details === 'object')
})

async function ensureRestishHarness(world: AmaWorld) {
  world.restishHarness ??= await createRestishOpenApiHarness()
  return world.restishHarness
}

async function requestOpenApiDocument(world: AmaWorld) {
  const app = createApp()
  const response = await app.fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
  assert.equal(response.status, 200)
  world.openApiDocument = (await response.json()) as OpenApiDocument
  assert.match(openApiDocument(world).openapi ?? '', /^3\./)
}

function openApiDocument(world: AmaWorld) {
  assert.ok(world.openApiDocument, 'OpenAPI document must be requested before asserting operations')
  return world.openApiDocument as OpenApiDocument
}

function allOperations(world: AmaWorld) {
  return Object.entries(openApiDocument(world).paths ?? {}).flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([method]) => ['get', 'post', 'patch', 'put', 'delete'].includes(method))
      .map(([method, op]) => ({ path, method, op })),
  )
}

function assertControlPlaneOperationsHaveMetadata(world: AmaWorld) {
  const operations = allOperations(world).filter(({ path }) => path.startsWith('/api/'))
  assert.ok(operations.length > 0, 'Expected control-plane OpenAPI operations')
  for (const { path, method, op } of operations) {
    assert.ok(op.operationId, `Expected operationId on ${method.toUpperCase()} ${path}`)
    assert.ok(op.summary, `Expected summary on ${method.toUpperCase()} ${path}`)
    assert.ok(op.tags?.length, `Expected tags on ${method.toUpperCase()} ${path}`)
    assert.ok(
      Object.keys(op.responses ?? {}).some((status) => /^2|^3|default$/.test(status)),
      `Expected success/default response on ${method.toUpperCase()} ${path}`,
    )
    if (!path.includes('/auth/') && path !== '/api/health' && path !== '/api/openapi.json') {
      assert.ok(
        op.security?.some((scheme) => 'bearerAuth' in scheme),
        `Expected bearerAuth on ${method.toUpperCase()} ${path}`,
      )
    }
  }
}
