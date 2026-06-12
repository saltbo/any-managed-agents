import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page, type Response } from '@playwright/test'
import { apiJson, apiResponse } from './local-app'
import { ensureSignedIn, type Json, type ListResponse, type StepsWorld } from './shared-helpers'

interface ConnectorRow {
  id: string
  connectorId: string
  name: string
  description: string
  category: string
  trustLevel: string
  capabilities: string[]
  supportedAuthModes: string[]
  setupRequirements: string[]
  status: string
  policyStatus: string
  connectionStatus: string
}

interface FilteredBrowse {
  criteria: { search?: string; category?: string; trustLevel?: string; capability?: string }
  rows: ConnectorRow[]
}

interface McpDiscoveryState {
  searchResults?: ConnectorRow[]
  catalogResults?: ConnectorRow[]
  filteredBrowses?: FilteredBrowse[]
  connector?: ConnectorRow
  unknownConnectorId?: string
}

type DiscoveryWorld = StepsWorld & { mcpDiscovery?: McpDiscoveryState }

function discoveryState(world: DiscoveryWorld): McpDiscoveryState {
  world.mcpDiscovery ??= {}
  return world.mcpDiscovery
}

function connectorsResponsePredicate(expectedParams: Record<string, string>) {
  return (response: Response) => {
    const url = new URL(response.url())
    if (!url.pathname.endsWith('/api/mcp/connectors')) {
      return false
    }
    for (const [key, value] of Object.entries(expectedParams)) {
      if (url.searchParams.get(key) !== value) {
        return false
      }
    }
    for (const key of ['search', 'category', 'trustLevel', 'capability']) {
      if (!(key in expectedParams) && url.searchParams.has(key)) {
        return false
      }
    }
    return true
  }
}

async function openDiscoveryPage(page: Page, path: string, expectedParams: Record<string, string>) {
  const responsePromise = page.waitForResponse(connectorsResponsePredicate(expectedParams))
  await page.goto(path)
  const response = await responsePromise
  assert.equal(response.status(), 200)
  return ((await response.json()) as ListResponse<ConnectorRow>).data
}

// ─── Scenario: Search MCP connectors ─────────────────────────────────────────

When('the user searches the connector catalog', async function (this: DiscoveryWorld) {
  const e2e = await ensureSignedIn(this)
  const state = discoveryState(this)
  await openDiscoveryPage(e2e.page, '/mcp', {})
  const responsePromise = e2e.page.waitForResponse(connectorsResponsePredicate({ search: 'GitHub' }))
  await e2e.page.getByLabel('Search connectors').fill('GitHub')
  const response = await responsePromise
  assert.equal(response.status(), 200)
  state.searchResults = ((await response.json()) as ListResponse<ConnectorRow>).data
})

Then(
  'results show capability, trust level, policy status, and setup requirements',
  async function (this: DiscoveryWorld) {
    const e2e = this.e2e
    const state = discoveryState(this)
    assert.ok(e2e, 'e2e state must exist')
    const results = state.searchResults
    assert.ok(results && results.length > 0, 'search must return matching connectors')
    for (const row of results) {
      assert.ok(row.capabilities.length > 0, `connector ${row.connectorId} must report capabilities`)
      assert.ok(row.trustLevel, `connector ${row.connectorId} must report a trust level`)
      assert.ok(row.policyStatus, `connector ${row.connectorId} must report a policy status`)
      assert.ok(row.setupRequirements.length > 0, `connector ${row.connectorId} must report setup requirements`)
    }
    const github = results.find((row) => row.connectorId === 'github')
    assert.ok(github, 'searching GitHub must surface the github connector')
    const row = e2e.page.locator('tr[data-connector-id="github"]')
    await expect(row.getByText(github.capabilities[0] as string)).toBeVisible()
    await expect(row.getByText(github.trustLevel).first()).toBeVisible()
    await expect(row.getByText(github.policyStatus).first()).toBeVisible()
    await expect(row.getByText(new RegExp(github.setupRequirements[0] as string))).toBeVisible()
  },
)

// ─── Scenario: List the connector catalog ────────────────────────────────────

Given('the platform has a connector catalog', async function (this: DiscoveryWorld) {
  const e2e = await ensureSignedIn(this)
  // Block one connector so the catalog visibly distinguishes blocked entries.
  await apiJson<Json>(e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: { mcpPolicy: { blockedConnectors: ['linear'] } },
  })
  const catalog = await apiJson<ListResponse<ConnectorRow>>(e2e.page.request, '/api/mcp/connectors')
  assert.ok(catalog.data.length >= 2, 'platform catalog must include seeded connectors')
})

When('the user opens MCP discovery', async function (this: DiscoveryWorld) {
  const e2e = this.e2e
  const state = discoveryState(this)
  assert.ok(e2e, 'e2e state must exist')
  state.catalogResults = await openDiscoveryPage(e2e.page, '/mcp', {})
})

Then(
  'connectors show id, name, description, category, trust level, supported auth modes, policy status, connection status, and setup requirements',
  async function (this: DiscoveryWorld) {
    const e2e = this.e2e
    const state = discoveryState(this)
    assert.ok(e2e, 'e2e state must exist')
    const results = state.catalogResults
    assert.ok(results && results.length >= 2, 'catalog listing must include the seeded connectors')
    for (const row of results) {
      assert.ok(row.id && row.connectorId && row.name && row.description, 'identity fields must be present')
      assert.ok(row.category && row.trustLevel, 'category and trust level must be present')
      assert.ok(row.supportedAuthModes.length > 0, 'supported auth modes must be present')
      assert.ok(row.policyStatus && row.connectionStatus, 'policy and connection status must be present')
      assert.ok(row.setupRequirements.length > 0, 'setup requirements must be present')
    }
    const github = results.find((row) => row.connectorId === 'github')
    assert.ok(github, 'github connector must be listed')
    const githubRow = e2e.page.locator('tr[data-connector-id="github"]')
    await expect(githubRow.getByText('GitHub').first()).toBeVisible()
    await expect(githubRow.getByText('github', { exact: true })).toBeVisible()
    await expect(githubRow.getByText(github.description)).toBeVisible()
    await expect(githubRow.getByText(github.category)).toBeVisible()
    await expect(githubRow.getByText(github.trustLevel).first()).toBeVisible()
    await expect(githubRow.getByText(new RegExp(github.supportedAuthModes[0] as string))).toBeVisible()
    await expect(githubRow.getByText(github.policyStatus).first()).toBeVisible()
    await expect(githubRow.getByText(github.connectionStatus)).toBeVisible()
    await expect(githubRow.getByText(new RegExp(github.setupRequirements[0] as string))).toBeVisible()
  },
)

Then(
  'unavailable or policy-blocked connectors are visibly disabled with an explanation',
  async function (this: DiscoveryWorld) {
    const e2e = this.e2e
    const state = discoveryState(this)
    assert.ok(e2e, 'e2e state must exist')
    const linear = state.catalogResults?.find((row) => row.connectorId === 'linear')
    assert.ok(linear, 'linear connector must be listed')
    assert.equal(linear.policyStatus, 'blocked')
    const linearRow = e2e.page.locator('tr[data-connector-id="linear"]')
    await expect(linearRow).toHaveAttribute('aria-disabled', 'true')
    await expect(linearRow.getByText('Blocked by governance policy.')).toBeVisible()
    // A disabled connector exposes no catalog detail link.
    await expect(linearRow.getByRole('link')).toHaveCount(0)
  },
)

// ─── Scenario: Search and filter connectors ──────────────────────────────────

Given('the connector catalog includes multiple categories', async function (this: DiscoveryWorld) {
  const e2e = await ensureSignedIn(this)
  const catalog = await apiJson<ListResponse<ConnectorRow>>(e2e.page.request, '/api/mcp/connectors')
  const categories = new Set(catalog.data.map((row) => row.category))
  assert.ok(categories.size >= 2, 'catalog must span multiple categories')
})

When('the user searches by name, category, capability, or trust level', async function (this: DiscoveryWorld) {
  const e2e = this.e2e
  const state = discoveryState(this)
  assert.ok(e2e, 'e2e state must exist')
  const browses: FilteredBrowse[] = []

  // Category through the interactive filter control.
  await openDiscoveryPage(e2e.page, '/mcp', {})
  const categoryResponse = e2e.page.waitForResponse(connectorsResponsePredicate({ category: 'planning' }))
  await e2e.page.getByRole('combobox', { name: 'Category' }).click()
  await e2e.page.getByRole('option', { name: 'planning' }).click()
  const category = await categoryResponse
  assert.equal(category.status(), 200)
  browses.push({
    criteria: { category: 'planning' },
    rows: ((await category.json()) as ListResponse<ConnectorRow>).data,
  })

  // Remaining facets through deep-linkable filter URLs.
  browses.push({
    criteria: { trustLevel: 'verified' },
    rows: await openDiscoveryPage(e2e.page, '/mcp?trustLevel=verified', { trustLevel: 'verified' }),
  })
  browses.push({
    criteria: { capability: 'repositories' },
    rows: await openDiscoveryPage(e2e.page, '/mcp?capability=repositories', { capability: 'repositories' }),
  })
  browses.push({
    criteria: { search: 'Linear' },
    rows: await openDiscoveryPage(e2e.page, '/mcp?search=Linear', { search: 'Linear' }),
  })
  state.filteredBrowses = browses
})

Then('every result matches the selected criteria', function (this: DiscoveryWorld) {
  const state = discoveryState(this)
  const browses = state.filteredBrowses
  assert.ok(browses && browses.length >= 4, 'filtered browses must be recorded')
  for (const browse of browses) {
    assert.ok(browse.rows.length > 0, `criteria ${JSON.stringify(browse.criteria)} must match catalog entries`)
    for (const row of browse.rows) {
      if (browse.criteria.category) {
        assert.equal(row.category, browse.criteria.category)
      }
      if (browse.criteria.trustLevel) {
        assert.equal(row.trustLevel, browse.criteria.trustLevel)
      }
      if (browse.criteria.capability) {
        assert.ok(row.capabilities.includes(browse.criteria.capability))
      }
      if (browse.criteria.search) {
        const needle = browse.criteria.search.toLowerCase()
        assert.ok(row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle))
      }
    }
  }
})

Then('no credential values are required to browse the catalog', async function (this: DiscoveryWorld) {
  const e2e = this.e2e
  const state = discoveryState(this)
  assert.ok(e2e, 'e2e state must exist')
  // The project holds no vault credentials, yet the whole catalog browsed fine.
  const vaults = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/vaults')
  assert.equal(vaults.data.length, 0, 'catalog browsing must not require provisioning credentials')
  const serialized = JSON.stringify(state.filteredBrowses)
  assert.equal(serialized.includes('secretValue'), false)
  assert.equal(serialized.includes('credentialSecretRef'), false)
})

// ─── Scenario: Inspect a connector ───────────────────────────────────────────

Given('a connector exists', async function (this: DiscoveryWorld) {
  const e2e = await ensureSignedIn(this)
  const state = discoveryState(this)
  state.connector = await apiJson<ConnectorRow>(e2e.page.request, '/api/mcp/connectors/github')
  assert.equal(state.connector.connectorId, 'github')
})

When('the user opens connector detail', async function (this: DiscoveryWorld) {
  const e2e = this.e2e
  assert.ok(e2e, 'e2e state must exist')
  const responsePromise = e2e.page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/api/mcp/connectors/github'),
  )
  await e2e.page.goto('/mcp/github')
  const response = await responsePromise
  assert.equal(response.status(), 200)
})

Then(
  'the page shows setup instructions, required credential type, available capabilities, policy status, and connection actions',
  async function (this: DiscoveryWorld) {
    const e2e = this.e2e
    const state = discoveryState(this)
    assert.ok(e2e, 'e2e state must exist')
    const connector = state.connector
    assert.ok(connector, 'connector must be loaded')
    await expect(e2e.page.getByText('Setup instructions')).toBeVisible()
    await expect(e2e.page.getByText(new RegExp(connector.setupRequirements[0] as string)).first()).toBeVisible()
    await expect(e2e.page.getByText('Required credential type')).toBeVisible()
    await expect(e2e.page.getByText('Capabilities')).toBeVisible()
    await expect(e2e.page.getByText(connector.capabilities.join(', '))).toBeVisible()
    await expect(e2e.page.getByText(connector.policyStatus).first()).toBeVisible()
    await expect(
      e2e.page.getByRole('button', { name: connector.connectionStatus === 'not_connected' ? 'Connect' : 'Disconnect' }),
    ).toBeVisible()
  },
)

Then('unknown connectors return a not-found error instead of a server error', async function (this: DiscoveryWorld) {
  const e2e = this.e2e
  const state = discoveryState(this)
  assert.ok(e2e, 'e2e state must exist')
  state.unknownConnectorId = `${e2e.runId}-missing-connector`
  const response = await apiResponse(e2e.page.request, `/api/mcp/connectors/${state.unknownConnectorId}`)
  assert.equal(response.status(), 404)
  const body = (await response.json()) as { error?: { type?: string } }
  assert.equal(body.error?.type, 'not_found')
  await e2e.page.goto(`/mcp/${state.unknownConnectorId}`)
  await expect(e2e.page.getByText('Connector not found')).toBeVisible()
})
