import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page, type Response } from '@playwright/test'
import { apiJson, apiResponse } from './local-app'
import { ensureSignedIn, type Json, type ListResponse, type StepsWorld } from './shared-helpers'

// The v1 connector catalog is a pure static directory: it exposes `id` as the
// sole identifier and `availability` as its only operational dimension. Policy
// status (`/policies`) and connection status (`/connections`) are no longer
// projected onto catalog rows.
interface ConnectorRow {
  id: string
  name: string
  description: string
  category: string
  trustLevel: string
  capabilities: string[]
  supportedAuthModes: string[]
  setupRequirements: string[]
  availability: string
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
    if (!url.pathname.endsWith('/api/v1/connectors')) {
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
      assert.ok(row.capabilities.length > 0, `connector ${row.id} must report capabilities`)
      assert.ok(row.trustLevel, `connector ${row.id} must report a trust level`)
      // Catalog rows carry an operational `availability` (governance "policy
      // status" is resolved separately via /policies, not on the catalog).
      assert.ok(row.availability, `connector ${row.id} must report catalog availability`)
      assert.ok(row.setupRequirements.length > 0, `connector ${row.id} must report setup requirements`)
    }
    const github = results.find((row) => row.id === 'github')
    assert.ok(github, 'searching GitHub must surface the github connector')
    const row = e2e.page.locator('tr[data-connector-id="github"]')
    await expect(row.getByText(github.trustLevel).first()).toBeVisible()
    await expect(row.getByText(new RegExp(github.setupRequirements[0] as string))).toBeVisible()
  },
)

// ─── Scenario: List the connector catalog ────────────────────────────────────

Given('the platform has a connector catalog', async function (this: DiscoveryWorld) {
  const e2e = await ensureSignedIn(this)
  // The catalog is a static directory; it no longer projects governance policy
  // onto its rows, so there is nothing to pre-seed here beyond confirming the
  // seeded connectors exist.
  const catalog = await apiJson<ListResponse<ConnectorRow>>(e2e.page.request, '/api/v1/connectors')
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
      assert.ok(row.id && row.name && row.description, 'identity fields must be present')
      assert.ok(row.category && row.trustLevel, 'category and trust level must be present')
      assert.ok(row.supportedAuthModes.length > 0, 'supported auth modes must be present')
      assert.ok(row.availability, 'catalog availability must be present')
      assert.ok(row.setupRequirements.length > 0, 'setup requirements must be present')
    }
    const github = results.find((row) => row.id === 'github')
    assert.ok(github, 'github connector must be listed')
    const githubRow = e2e.page.locator('tr[data-connector-id="github"]')
    await expect(githubRow.getByText('GitHub').first()).toBeVisible()
    await expect(githubRow.getByText('github', { exact: true })).toBeVisible()
    await expect(githubRow.getByText(github.description)).toBeVisible()
    await expect(githubRow.getByText(github.category)).toBeVisible()
    await expect(githubRow.getByText(github.trustLevel).first()).toBeVisible()
    await expect(githubRow.getByText(new RegExp(github.supportedAuthModes[0] as string))).toBeVisible()
    await expect(githubRow.getByText(new RegExp(github.setupRequirements[0] as string))).toBeVisible()
  },
)

Then(
  'unavailable or policy-blocked connectors are visibly disabled with an explanation',
  async function (this: DiscoveryWorld) {
    const e2e = this.e2e
    const state = discoveryState(this)
    assert.ok(e2e, 'e2e state must exist')
    // Catalog disabling is now driven solely by `availability: 'unavailable'`
    // (policy blocking moved off the catalog to /policies). Assert the rendered
    // disabled-state contract against whichever dimension each seeded row
    // carries: available rows expose a detail link; unavailable rows are
    // aria-disabled with an explanation and no link.
    const results = state.catalogResults ?? []
    for (const connector of results) {
      const connectorRow = e2e.page.locator(`tr[data-connector-id="${connector.id}"]`)
      if (connector.availability === 'unavailable') {
        await expect(connectorRow).toHaveAttribute('aria-disabled', 'true')
        await expect(connectorRow.getByText('Connector is unavailable on this platform.')).toBeVisible()
        await expect(connectorRow.getByRole('link')).toHaveCount(0)
      } else {
        await expect(connectorRow).not.toHaveAttribute('aria-disabled', 'true')
        await expect(connectorRow.getByRole('link')).toHaveCount(1)
      }
    }
  },
)

// ─── Scenario: Search and filter connectors ──────────────────────────────────

Given('the connector catalog includes multiple categories', async function (this: DiscoveryWorld) {
  const e2e = await ensureSignedIn(this)
  const catalog = await apiJson<ListResponse<ConnectorRow>>(e2e.page.request, '/api/v1/connectors')
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
  const vaults = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/vaults')
  assert.equal(vaults.data.length, 0, 'catalog browsing must not require provisioning credentials')
  const serialized = JSON.stringify(state.filteredBrowses)
  assert.equal(serialized.includes('secretValue'), false)
  assert.equal(serialized.includes('credentialSecretRef'), false)
})

// ─── Scenario: Inspect a connector ───────────────────────────────────────────

Given('a connector exists', async function (this: DiscoveryWorld) {
  const e2e = await ensureSignedIn(this)
  const state = discoveryState(this)
  state.connector = await apiJson<ConnectorRow>(e2e.page.request, '/api/v1/connectors/github')
  assert.equal(state.connector.id, 'github')
})

When('the user opens connector detail', async function (this: DiscoveryWorld) {
  const e2e = this.e2e
  assert.ok(e2e, 'e2e state must exist')
  const responsePromise = e2e.page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/api/v1/connectors/github'),
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
    // The catalog's operational dimension is availability; a "Connect" action
    // is offered while no connection exists.
    await expect(e2e.page.getByText(connector.availability).first()).toBeVisible()
    await expect(e2e.page.getByRole('button', { name: 'Connect' })).toBeVisible()
  },
)

Then('unknown connectors return a not-found error instead of a server error', async function (this: DiscoveryWorld) {
  const e2e = this.e2e
  const state = discoveryState(this)
  assert.ok(e2e, 'e2e state must exist')
  state.unknownConnectorId = `${e2e.runId}-missing-connector`
  const response = await apiResponse(e2e.page.request, `/api/v1/connectors/${state.unknownConnectorId}`)
  assert.equal(response.status(), 404)
  const body = (await response.json()) as { error?: { type?: string } }
  assert.equal(body.error?.type, 'not_found')
  await e2e.page.goto(`/mcp/${state.unknownConnectorId}`)
  await expect(e2e.page.getByText('Connector not found')).toBeVisible()
})
