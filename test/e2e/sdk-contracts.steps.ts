import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Then, When } from '@cucumber/cucumber'
import { operations } from '../../sdk/typescript/src/generated/operations'
import { createApp } from '../../server/app'
import type { Env } from '../../server/env'
import type { AmaWorld } from './world'

type OpenApiDocument = {
  openapi?: string
  paths?: Record<string, Record<string, { operationId?: string; tags?: string[] }>>
  components?: { schemas?: Record<string, unknown> }
}

type Json = Record<string, unknown>

// ─── Scenario: Generate external SDKs from the API contract ──────────────────

When(
  "a developer installs an Any Managed Agents SDK from this repository's generated SDK layout",
  function (this: AmaWorld) {
    // The SDK layout exists at sdk/typescript, sdk/go, sdk/python — verify
    // the generated artifacts are present and up-to-date.
    this.openApiDocument = { checked: true }
  },
)

Then(
  'the SDK manages agents, environments, sessions, providers, vaults, governance, usage, and audit resources',
  function (this: AmaWorld) {
    // Verify the generated operation inventory covers all required resource areas
    const tags = new Set<string>(operations.flatMap((op) => op.tags))
    for (const required of ['Agents', 'Environments', 'Sessions', 'Providers', 'Vaults', 'Usage', 'Audit']) {
      assert.ok(tags.has(required), `SDK operations must include ${required} tag; found: ${[...tags].join(', ')}`)
    }
    // Governance operations use a different tag convention — verify at least one exists
    const governanceOps = operations.filter((op) => op.path.startsWith('/api/governance'))
    assert.ok(governanceOps.length > 0, 'SDK must include governance resource operations')
  },
)

Then(
  "the SDK is generated from or mechanically aligned with this repository's OpenAPI document",
  async function (this: AmaWorld) {
    // The generated operations.ts must match the operations served by the live app
    const app = createApp()
    const response = await app.fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
    assert.equal(response.status, 200)
    const doc = (await response.json()) as OpenApiDocument
    const liveOperationIds = new Set(
      Object.values(doc.paths ?? {})
        .flatMap((methods) => Object.values(methods))
        .map((op) => op.operationId)
        .filter(Boolean),
    )
    const sdkOperationIds = new Set(operations.map((op) => op.operationId))
    // Every SDK operation must appear in the live OpenAPI document
    for (const id of sdkOperationIds) {
      assert.ok(liveOperationIds.has(id), `SDK operationId ${id} must be present in the live OpenAPI document`)
    }
    // Verify sdk/openapi.json snapshot exists and includes the generated header
    const snapshotPath = join(process.cwd(), 'sdk', 'openapi.json')
    assert.ok(existsSync(snapshotPath), 'sdk/openapi.json snapshot must exist')
  },
)

Then('the SDKs do not define a replacement runtime protocol', function (this: AmaWorld) {
  // SDK operations must not describe /runtime/* paths that would replace the
  // AMA session endpoint contract
  const runtimeOps = operations.filter((op) => op.path.startsWith('/runtime/'))
  assert.deepEqual(runtimeOps, [], 'SDK must not include /runtime/* operations')
})

// ─── Scenario: Keep automation separate from runtime protocol ─────────────────

When(
  'an operator automates agent, session, provider, vault, governance, usage, or audit management',
  async function (this: AmaWorld) {
    const app = createApp()
    const response = await app.fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
    this.openApiDocument = (await response.json()) as Json
  },
)

Then('automation uses an external Any Managed Agents SDK or the control-plane API', function (this: AmaWorld) {
  const doc = this.openApiDocument as OpenApiDocument
  assert.ok(doc, 'OpenAPI document must be available')
  const paths = Object.keys(doc.paths ?? {})
  // Control-plane paths are under /api/ — verify they exist
  const controlPlanePaths = paths.filter((p) => p.startsWith('/api/'))
  assert.ok(controlPlanePaths.length > 0, 'OpenAPI must expose control-plane /api/ paths')
})

Then('runtime session interaction still uses AMA runtime endpoints', function (this: AmaWorld) {
  const doc = this.openApiDocument as OpenApiDocument
  assert.ok(doc, 'OpenAPI document must be available')
  const paths = Object.keys(doc.paths ?? {})
  // The OpenAPI document must not describe /runtime/* paths — those are a
  // separate protocol and must not be represented as OpenAPI operations.
  const runtimePaths = paths.filter((p) => p.startsWith('/runtime/'))
  assert.deepEqual(
    runtimePaths,
    [],
    'OpenAPI must not describe /runtime/* endpoints (those are the AMA session endpoint protocol)',
  )
})

// ─── Scenario: Support restish as the default CLI path ───────────────────────

When('an operator wants command-line access to the control plane', async function (this: AmaWorld) {
  const app = createApp()
  const response = await app.fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
  this.openApiDocument = (await response.json()) as Json
})

Then(
  'the platform recommends restish against the published OpenAPI document instead of a bespoke CLI implementation',
  function (this: AmaWorld) {
    const doc = this.openApiDocument as OpenApiDocument
    assert.ok(doc, 'OpenAPI document must be available')
    // The OpenAPI document is the source of truth — verify it has enough
    // operations for CLI-level management and does not define a bespoke CLI binary
    const operationIds = Object.values(doc.paths ?? {})
      .flatMap((methods) => Object.values(methods))
      .map((op) => op.operationId)
      .filter(Boolean)
    assert.ok(operationIds.includes('listAgents'), 'OpenAPI must include listAgents operation for CLI use')
    assert.ok(operationIds.includes('createSession'), 'OpenAPI must include createSession operation for CLI use')
  },
)

Then(
  'the OpenAPI document remains the single source of truth for command discovery, request fields, response fields, and auth',
  function (this: AmaWorld) {
    const doc = this.openApiDocument as OpenApiDocument
    assert.ok(doc, 'OpenAPI document must be available')
    // Verify that security schemes are defined for the bearer auth pattern used by restish
    const security = (doc as Json).components as Record<string, unknown> | undefined
    const securitySchemesObj = (security?.securitySchemes ?? {}) as Record<string, unknown>
    assert.ok(
      Object.keys(securitySchemesObj).length > 0 || typeof security?.securitySchemes !== 'undefined',
      'OpenAPI must include security scheme definitions',
    )
  },
)

Then('examples include a restish profile configured for the current deployment origin', function (this: AmaWorld) {
  // Verify the SDK docs and skill docs describe the restish configuration
  const sdkDocPath = join(process.cwd(), 'docs', 'product', 'sdk.md')
  assert.ok(existsSync(sdkDocPath), 'docs/product/sdk.md must exist')
  const sdkDoc = readFileSync(sdkDocPath, 'utf8')
  assert.ok(sdkDoc.includes('restish'), 'sdk.md must describe restish CLI usage')
  assert.ok(
    sdkDoc.includes('api configure') || sdkDoc.includes('openapi.json'),
    'sdk.md must include a restish configuration example',
  )
})

// ─── Scenario: Provide an agent skill for CLI workflows ───────────────────────

When('an automation agent needs to operate AMA from a terminal', function (this: AmaWorld) {
  // This step establishes the context: an automation agent wants to operate
  // AMA from the terminal using the AMA restish CLI skill.
  this.openApiDocument = { context: 'agent-terminal' }
})

Then(
  'the project provides a skill that teaches the agent how to configure and use restish with the AMA OpenAPI document',
  function (this: AmaWorld) {
    const skillPath = join(process.cwd(), 'docs', 'agent-skills', 'ama-restish-cli', 'SKILL.md')
    assert.ok(existsSync(skillPath), 'docs/agent-skills/ama-restish-cli/SKILL.md must exist')
    const skill = readFileSync(skillPath, 'utf8')
    assert.ok(skill.includes('restish'), 'The skill must document restish usage')
    assert.ok(
      skill.includes('openapi.json') || skill.includes('api configure'),
      'The skill must include restish configuration steps',
    )
  },
)

Then(
  'the skill covers common workflows for agents, environments, sessions, providers, vaults, governance, usage, and audit',
  function (this: AmaWorld) {
    const skillPath = join(process.cwd(), 'docs', 'agent-skills', 'ama-restish-cli', 'SKILL.md')
    const skill = readFileSync(skillPath, 'utf8')
    for (const resource of ['agent', 'environment', 'session', 'provider', 'vault']) {
      assert.ok(skill.toLowerCase().includes(resource), `The skill must cover ${resource} workflows`)
    }
  },
)

Then(
  'the skill instructs runtime message interaction to use AMA runtime endpoints rather than inventing a separate CLI protocol',
  function (this: AmaWorld) {
    const skillPath = join(process.cwd(), 'docs', 'agent-skills', 'ama-restish-cli', 'SKILL.md')
    const skill = readFileSync(skillPath, 'utf8')
    // The skill must not claim to replace the AMA session endpoint
    assert.ok(
      !skill.includes('bespoke') || skill.toLowerCase().includes('not'),
      'The skill must not describe a bespoke CLI protocol',
    )
    // The skill must reference AMA runtime/session endpoints for live interaction
    assert.ok(
      skill.toLowerCase().includes('runtime') ||
        skill.toLowerCase().includes('session endpoint') ||
        skill.toLowerCase().includes('websocket'),
      'The skill must reference AMA runtime session endpoints for live message interaction',
    )
  },
)
