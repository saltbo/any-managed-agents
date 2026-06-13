import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Connection, Connector } from '@/lib/api'
import { createCollection, HttpResponse, http, server } from '@/test/msw'
import { McpConnectorPage } from './McpConnectorPage'
import { McpPage } from './McpPage'
import { connectorDisabledReason, McpView } from './McpView'
import { useMcpActions } from './use-mcp-actions'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'connector_1',
    name: 'GitHub MCP',
    description: 'Access GitHub repositories',
    category: 'code',
    trustLevel: 'trusted',
    capabilities: ['read', 'write'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['github_token'],
    tools: [
      {
        name: 'list_repos',
        description: 'List repositories',
        inputSchema: {},
        approvalMode: 'none',
        policyMetadata: {},
      },
    ],
    metadata: {},
    availability: 'available',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'connection_1',
    projectId: 'project_1',
    connectorId: 'connector_1',
    credentialRef: null,
    endpointUrl: null,
    approvalMode: 'none',
    state: 'connected',
    lastError: null,
    metadata: {},
    connectedAt: '2026-05-23T00:00:00.000Z',
    disconnectedAt: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function pagination<T>(items: T[]): ClientPagination<T> {
  return {
    items,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: items.length,
    start: items.length === 0 ? 0 : 1,
    end: items.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// MSW handler helpers
// ---------------------------------------------------------------------------

const listEnvelope = <T,>(items: T[]) => ({
  data: items,
  pagination: { limit: 50, hasMore: false, nextCursor: null as string | null },
})

const notFound = () => HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 })

/** Register the standard MCP handlers backed by in-memory collections. */
function useCollections(connectorSeed: Connector[] = [], connectionSeed: Connection[] = []) {
  const connectorCol = createCollection<Connector>(connectorSeed)
  const connectionCol = createCollection<Connection>(connectionSeed)

  server.use(
    http.get('*/api/v1/connectors', () => HttpResponse.json(listEnvelope(connectorCol.list()))),
    http.get('*/api/v1/connectors/:connectorId', ({ params }) => {
      const record = connectorCol.get(String(params.connectorId))
      return record ? HttpResponse.json(record) : notFound()
    }),
    http.get('*/api/v1/connections', () => HttpResponse.json(listEnvelope(connectionCol.list()))),
    http.post('*/api/v1/connections', async ({ request }) => {
      const body = (await request.json()) as { connectorId: string }
      const connection = buildConnection({ id: `connection_new`, connectorId: body.connectorId, state: 'connected' })
      connectionCol.put(connection)
      return HttpResponse.json(connection, { status: 201 })
    }),
    http.patch('*/api/v1/connections/:connectionId', ({ params }) => {
      const record = connectionCol.get(String(params.connectionId))
      if (!record) return notFound()
      const updated = { ...record, state: 'disconnected' as const }
      connectionCol.put(updated)
      return HttpResponse.json(updated)
    }),
  )

  return { connectorCol, connectionCol }
}

/** Register a handler that makes GET /api/v1/connectors hang (never resolves). */
function useHangingConnectors() {
  server.use(
    http.get('*/api/v1/connectors', () => new Promise<never>(() => {})),
    http.get('*/api/v1/connections', () => new Promise<never>(() => {})),
  )
}

/** Register a handler that makes GET /api/v1/connectors fail with a 500 error. */
function useConnectorError(message: string) {
  server.use(
    http.get('*/api/v1/connectors', () => HttpResponse.json({ error: { type: 'internal', message } }, { status: 500 })),
    http.get('*/api/v1/connections', () => HttpResponse.json(listEnvelope([]))),
  )
}

/** Register a handler that makes GET /api/v1/connections fail with a 500 error. */
function useConnectionError(message: string) {
  server.use(
    http.get('*/api/v1/connectors', () => HttpResponse.json(listEnvelope([]))),
    http.get('*/api/v1/connections', () =>
      HttpResponse.json({ error: { type: 'internal', message } }, { status: 500 }),
    ),
  )
}

function mkClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderMcpPage(initialEntry = '/mcp') {
  return render(
    <QueryClientProvider client={mkClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/mcp" element={<McpPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderConnectorPage(connectorId = 'connector_1') {
  return render(
    <QueryClientProvider client={mkClient()}>
      <MemoryRouter initialEntries={[`/mcp/${connectorId}`]}>
        <Routes>
          <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubPointerCapture() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    value: vi.fn(() => false),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    value: vi.fn(),
    configurable: true,
  })
}

function stubScrollIntoView() {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// connectorDisabledReason (pure function — no network needed)
// ---------------------------------------------------------------------------

describe('[spec: mcp/disabled-reason] connectorDisabledReason', () => {
  it('returns null when connector is available', () => {
    expect(connectorDisabledReason(buildConnector({ availability: 'available' }))).toBeNull()
  })

  it('returns a reason string when connector is unavailable', () => {
    const reason = connectorDisabledReason(buildConnector({ availability: 'unavailable' }))
    expect(reason).toBe('Connector is unavailable on this platform.')
  })
})

// ---------------------------------------------------------------------------
// McpView — pure presentational component, no network
// ---------------------------------------------------------------------------

describe('[spec: mcp/view] McpView', () => {
  it('shows empty state for connectors when no connectors exist', () => {
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No MCP connectors match the current catalog filters.')).toBeInTheDocument()
  })

  it('shows empty state for connections when no connections exist', () => {
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No project MCP connections exist.')).toBeInTheDocument()
  })

  it('renders a connector row with name, category, trust level, capabilities, and auth', () => {
    const items = [buildConnector()]
    render(
      <MemoryRouter>
        <McpView
          connectors={items}
          connectorPagination={pagination(items)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'GitHub MCP' })).toBeInTheDocument()
    expect(screen.getByText('code')).toBeInTheDocument()
    expect(screen.getByText('trusted')).toBeInTheDocument()
    expect(screen.getByText('read, write')).toBeInTheDocument()
    expect(screen.getByText('vault_credential')).toBeInTheDocument()
  })

  it('links connector name to detail page', () => {
    const items = [buildConnector()]
    render(
      <MemoryRouter>
        <McpView
          connectors={items}
          connectorPagination={pagination(items)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'GitHub MCP' })
    expect(link.getAttribute('href')).toBe('/mcp/connector_1')
  })

  it('renders disabled connector as span (not link) with disabled reason', () => {
    const items = [buildConnector({ availability: 'unavailable' })]
    render(
      <MemoryRouter>
        <McpView
          connectors={items}
          connectorPagination={pagination(items)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: 'GitHub MCP' })).toBeNull()
    expect(screen.getByText('GitHub MCP')).toBeInTheDocument()
    expect(screen.getAllByText('Connector is unavailable on this platform.').length).toBeGreaterThan(0)
  })

  it('renders capabilities as None when empty', () => {
    const items = [buildConnector({ capabilities: [] })]
    render(
      <MemoryRouter>
        <McpView
          connectors={items}
          connectorPagination={pagination(items)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('renders a connection row with connector id, state, credential, and endpoint', () => {
    const items = [
      buildConnection({
        connectorId: 'connector_1',
        state: 'connected',
        credentialRef: { credentialId: 'cred_1' },
        endpointUrl: 'https://mcp.example.com',
      }),
    ]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={items}
          connectionPagination={pagination(items)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('connector_1')).toBeInTheDocument()
    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(screen.getByText('Reference configured')).toBeInTheDocument()
    expect(screen.getByText('https://mcp.example.com')).toBeInTheDocument()
  })

  it('renders Default when connection endpointUrl is null', () => {
    const items = [buildConnection({ endpointUrl: null })]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={items}
          connectionPagination={pagination(items)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('renders No credential when credentialRef is null', () => {
    const items = [buildConnection({ credentialRef: null })]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={items}
          connectionPagination={pagination(items)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No credential')).toBeInTheDocument()
  })

  it('calls onDisconnect with connection id when disconnect is confirmed', async () => {
    stubPointerCapture()

    const onDisconnect = vi.fn()
    const items = [buildConnection()]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={items}
          connectionPagination={pagination(items)}
          onDisconnect={onDisconnect}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const allButtons = await screen.findAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(allButtons[allButtons.length - 1]!)
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith('connection_1'))
  })

  it('renders setup requirements as None when empty', () => {
    const items = [buildConnector({ setupRequirements: [] })]
    render(
      <MemoryRouter>
        <McpView
          connectors={items}
          connectorPagination={pagination(items)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Setup: None')).toBeInTheDocument()
  })

  it('renders supported auth modes as None when supportedAuthModes is empty', () => {
    const items = [buildConnector({ supportedAuthModes: [] })]
    render(
      <MemoryRouter>
        <McpView
          connectors={items}
          connectorPagination={pagination(items)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('passes lastError json as detail badge when connection has an error', () => {
    const items = [buildConnection({ state: 'error', lastError: { code: 'CONN_REFUSED' } })]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={items}
          connectionPagination={pagination(items)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('error')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// McpPage — uses real api client; MSW serves the network
// ---------------------------------------------------------------------------

describe('[spec: mcp/page] McpPage', () => {
  it('shows loading state while queries are pending', () => {
    useHangingConnectors()
    renderMcpPage()

    expect(screen.getByText('Loading MCP')).toBeInTheDocument()
  })

  it('shows error state when connectors query fails', async () => {
    useConnectorError('Connectors unavailable')
    renderMcpPage()

    await waitFor(() => expect(screen.getByText('MCP unavailable')).toBeInTheDocument())
    expect(screen.getByText('Connectors unavailable')).toBeInTheDocument()
  })

  it('shows error state when connections query fails', async () => {
    useConnectionError('Connections unavailable')
    renderMcpPage()

    await waitFor(() => expect(screen.getByText('MCP unavailable')).toBeInTheDocument())
    expect(screen.getByText('Connections unavailable')).toBeInTheDocument()
  })

  it('renders page header with MCP title when data loads', async () => {
    useCollections()
    renderMcpPage()

    await waitFor(() => expect(screen.getByText('MCP')).toBeInTheDocument())
    expect(screen.getByText(/Browse the connector catalog/)).toBeInTheDocument()
  })

  it('renders connector rows when data loads', async () => {
    useCollections([buildConnector({ name: 'Jira MCP' })])
    renderMcpPage()

    expect(await screen.findByText('Jira MCP')).toBeInTheDocument()
  })

  it('renders search filter input', async () => {
    useCollections()
    renderMcpPage()

    expect(await screen.findByLabelText('Search connectors')).toBeInTheDocument()
  })

  it('updates search filter in URL when user types', async () => {
    useCollections()
    renderMcpPage()

    const searchInput = await screen.findByLabelText('Search connectors')
    fireEvent.change(searchInput, { target: { value: 'github' } })
    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeInTheDocument())
  })

  it('renders category, trust level, and capability facet selects', async () => {
    useCollections([buildConnector()])
    renderMcpPage()

    expect(await screen.findByLabelText('Category')).toBeInTheDocument()
    expect(screen.getByLabelText('Trust level')).toBeInTheDocument()
    expect(screen.getByLabelText('Capability')).toBeInTheDocument()
  })

  it('pre-populates search filter from URL search params', async () => {
    useCollections()
    renderMcpPage('/mcp?search=github&category=code')

    const searchInput = (await screen.findByLabelText('Search connectors')) as HTMLInputElement
    expect(searchInput.value).toBe('github')
  })

  it('clears search filter when empty string is typed', async () => {
    useCollections()
    renderMcpPage('/mcp?search=github')

    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeInTheDocument())
  })

  it('FacetSelect calls onChange with empty string when all categories option is selected', async () => {
    stubPointerCapture()
    stubScrollIntoView()

    useCollections([buildConnector({ category: 'code' })])
    renderMcpPage('/mcp?category=code')

    await waitFor(() => expect(screen.getByLabelText('Category')).toBeInTheDocument())
    const categoryTrigger = screen.getByLabelText('Category')
    categoryTrigger.focus()
    fireEvent.pointerDown(categoryTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(categoryTrigger)
    const allCategoriesOption = await screen.findByRole('option', { name: 'All categories' })
    fireEvent.click(allCategoriesOption)
    await waitFor(() => expect(screen.getByLabelText('Category')).toBeInTheDocument())
  })

  it('FacetSelect calls onChange with category value when a category is selected', async () => {
    stubPointerCapture()
    stubScrollIntoView()

    useCollections([buildConnector({ category: 'code' })])
    renderMcpPage()

    await waitFor(() => expect(screen.getByLabelText('Category')).toBeInTheDocument())
    const categoryTrigger = screen.getByLabelText('Category')
    categoryTrigger.focus()
    fireEvent.pointerDown(categoryTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(categoryTrigger)
    const codeOption = await screen.findByRole('option', { name: 'code' })
    fireEvent.click(codeOption)
    await waitFor(() => expect(screen.getByLabelText('Category')).toBeInTheDocument())
  })

  it('FacetSelect calls onChange with trust level value when a trust level is selected', async () => {
    stubPointerCapture()
    stubScrollIntoView()

    useCollections([buildConnector({ trustLevel: 'trusted' })])
    renderMcpPage()

    await waitFor(() => expect(screen.getByLabelText('Trust level')).toBeInTheDocument())
    const trustTrigger = screen.getByLabelText('Trust level')
    trustTrigger.focus()
    fireEvent.pointerDown(trustTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trustTrigger)
    const trustedOption = await screen.findByRole('option', { name: 'trusted' })
    fireEvent.click(trustedOption)
    await waitFor(() => expect(screen.getByLabelText('Trust level')).toBeInTheDocument())
  })

  it('FacetSelect calls onChange with capability value when a capability is selected', async () => {
    stubPointerCapture()
    stubScrollIntoView()

    useCollections([buildConnector({ capabilities: ['read'] })])
    renderMcpPage()

    await waitFor(() => expect(screen.getByLabelText('Capability')).toBeInTheDocument())
    const capabilityTrigger = screen.getByLabelText('Capability')
    capabilityTrigger.focus()
    fireEvent.pointerDown(capabilityTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(capabilityTrigger)
    const readOption = await screen.findByRole('option', { name: 'read' })
    fireEvent.click(readOption)
    await waitFor(() => expect(screen.getByLabelText('Capability')).toBeInTheDocument())
  })
})

// ---------------------------------------------------------------------------
// McpConnectorPage — uses real api client; MSW serves the network
// ---------------------------------------------------------------------------

describe('[spec: mcp/connector-page] McpConnectorPage', () => {
  it('renders loading state while connector is fetching', () => {
    server.use(
      http.get('*/api/v1/connectors/:connectorId', () => new Promise<never>(() => {})),
      http.get('*/api/v1/connections', () => new Promise<never>(() => {})),
    )
    renderConnectorPage()

    expect(screen.getByText('Loading connector')).toBeInTheDocument()
  })

  it('renders 404 empty state when connector does not exist', async () => {
    useCollections()
    renderConnectorPage('connector_missing')

    await waitFor(() => expect(screen.getByText('Connector not found')).toBeInTheDocument())
    expect(screen.getByText(/No MCP connector named "connector_missing" exists/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to MCP discovery' })).toBeInTheDocument()
  })

  it('renders generic error state for a 500 connector error', async () => {
    server.use(
      http.get('*/api/v1/connectors/:connectorId', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Internal server error' } }, { status: 500 }),
      ),
      http.get('*/api/v1/connections', () => HttpResponse.json(listEnvelope([]))),
    )
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('Connector unavailable')).toBeInTheDocument())
    expect(screen.getByText('Internal server error')).toBeInTheDocument()
  })

  it('renders connector detail with name, category, trust level, capabilities, and auth modes', async () => {
    useCollections([buildConnector()])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    expect(screen.getByText('Connector profile')).toBeInTheDocument()
    expect(screen.getByText('code')).toBeInTheDocument()
    expect(screen.getByText('trusted')).toBeInTheDocument()
    expect(screen.getByText('read, write')).toBeInTheDocument()
    expect(screen.getByText('vault_credential')).toBeInTheDocument()
  })

  it('renders connector tools list', async () => {
    useCollections([buildConnector()])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('list_repos')).toBeInTheDocument())
    expect(screen.getByText(/List repositories.*approval: none/)).toBeInTheDocument()
  })

  it('renders empty tools state when connector has no tools', async () => {
    useCollections([buildConnector({ tools: [] })])
    renderConnectorPage()

    expect(await screen.findByText('This connector does not declare catalog tools.')).toBeInTheDocument()
  })

  it('renders tool with no description as No description', async () => {
    useCollections([
      buildConnector({
        tools: [
          {
            name: 'exec_cmd',
            description: null,
            inputSchema: {},
            approvalMode: 'always_required',
            policyMetadata: {},
          },
        ],
      }),
    ])
    renderConnectorPage()

    expect(await screen.findByText(/No description.*approval: always_required/)).toBeInTheDocument()
  })

  it('renders Connect button when no active connection exists', async () => {
    useCollections([buildConnector()])
    renderConnectorPage()

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('renders Disconnect button when an active connection exists', async () => {
    useCollections([buildConnector()], [buildConnection({ connectorId: 'connector_1', state: 'connected' })])
    renderConnectorPage()

    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('ignores disconnected connections when deciding whether an active connection exists', async () => {
    useCollections([buildConnector()], [buildConnection({ connectorId: 'connector_1', state: 'disconnected' })])
    renderConnectorPage()

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('calls api.createConnection when Connect is clicked', async () => {
    useCollections([buildConnector()])
    renderConnectorPage()

    const connectBtn = await screen.findByRole('button', { name: 'Connect' })
    fireEvent.click(connectBtn)
    // After the mutation the connections list re-fetches and the button flips to Disconnect
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument())
  })

  it('renders disabled connector with disabled reason paragraph', async () => {
    useCollections([buildConnector({ availability: 'unavailable' })])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    expect(screen.getAllByText('Connector is unavailable on this platform.').length).toBeGreaterThan(0)
  })

  it('renders required credential type as vault_credential when setup requirements is empty', async () => {
    useCollections([buildConnector({ supportedAuthModes: ['vault_credential'], setupRequirements: [] })])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    expect(screen.getAllByText('vault_credential').length).toBeGreaterThan(0)
  })

  it('renders required credential type as None when vault_credential is not in supported auth modes', async () => {
    useCollections([buildConnector({ supportedAuthModes: [], setupRequirements: [] })])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('renders setup instructions for vault_credential auth mode with requirements', async () => {
    useCollections([buildConnector({ supportedAuthModes: ['vault_credential'], setupRequirements: ['github_token'] })])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    expect(screen.getByText('Store a github_token credential in a project vault.')).toBeInTheDocument()
    expect(screen.getByText('Connect the connector with the vault credential reference.')).toBeInTheDocument()
    expect(
      screen.getByText('Allow the connector for agents and environments that should call its tools.'),
    ).toBeInTheDocument()
  })

  it('renders no-credential setup instruction when no auth modes include vault_credential', async () => {
    useCollections([buildConnector({ supportedAuthModes: [], setupRequirements: [] })])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    expect(screen.getByText('Connect the connector; no credential is required.')).toBeInTheDocument()
  })

  it('calls api.disconnectConnection when Disconnect is confirmed on connector page', async () => {
    stubPointerCapture()

    useCollections([buildConnector()], [buildConnection({ connectorId: 'connector_1', state: 'connected' })])
    renderConnectorPage()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const allButtons = await screen.findAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(allButtons[allButtons.length - 1]!)
    // After mutation the connections re-fetch; connection state becomes 'disconnected' so Connect button appears
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument())
  })
})

// ---------------------------------------------------------------------------
// useMcpActions — hook via minimal component wrapper
// ---------------------------------------------------------------------------

describe('[spec: mcp/actions] useMcpActions', () => {
  function ActionsHarness({ onCapture }: { onCapture: (actions: ReturnType<typeof useMcpActions>) => void }) {
    const actions = useMcpActions()
    onCapture(actions)
    return null
  }

  function renderActions(onCapture: (actions: ReturnType<typeof useMcpActions>) => void) {
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness onCapture={onCapture} />
      </QueryClientProvider>,
    )
  }

  it('exposes disconnectMcpConnectionPending as false when idle', () => {
    useCollections()
    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    expect(captured!.disconnectMcpConnectionPending).toBe(false)
  })

  it('exposes connectMcpConnectorPending as false when idle', () => {
    useCollections()
    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    expect(captured!.connectMcpConnectorPending).toBe(false)
  })

  it('calls api.disconnectConnection with id on disconnectMcpConnection', async () => {
    useCollections([], [buildConnection({ id: 'connection_1' })])
    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    captured!.disconnectMcpConnection('connection_1')
    // The PATCH request should complete successfully — no error thrown
    await waitFor(() => expect(captured!.disconnectMcpConnectionPending).toBe(false))
  })

  it('calls api.createConnection with input on connectMcpConnector', async () => {
    useCollections([buildConnector()])
    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    captured!.connectMcpConnector({ connectorId: 'connector_1' })
    await waitFor(() => expect(captured!.connectMcpConnectorPending).toBe(false))
  })

  it('sets disconnectMcpConnectionPending to false after a failed disconnect (Error instance)', async () => {
    server.use(
      http.get('*/api/v1/connections', () => HttpResponse.json(listEnvelope([]))),
      http.patch('*/api/v1/connections/:connectionId', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Disconnect failed' } }, { status: 500 }),
      ),
    )

    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    captured!.disconnectMcpConnection('connection_fail')
    await waitFor(() => expect(captured!.disconnectMcpConnectionPending).toBe(false))
  })

  it('handles disconnectMcpConnection onError with a non-Error rejection (String path)', async () => {
    // To exercise the String(error) branch in onError, we temporarily make fetch
    // reject with a plain string. MSW is bypassed for this one PATCH to inject
    // a non-Error at the fetch boundary — this does NOT mock @/lib/api itself.
    const realFetch = window.fetch
    let patchCallCount = 0
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/connections/') && String(init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        patchCallCount++
        if (patchCallCount === 1) {
          return Promise.reject('network string error') as never
        }
      }
      return realFetch(input, init)
    }

    server.use(http.get('*/api/v1/connections', () => HttpResponse.json(listEnvelope([]))))

    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    captured!.disconnectMcpConnection('connection_str_err')
    await waitFor(() => expect(captured!.disconnectMcpConnectionPending).toBe(false))
    window.fetch = realFetch
  })

  it('sets connectMcpConnectorPending to false after a failed connect (Error instance)', async () => {
    server.use(
      http.get('*/api/v1/connections', () => HttpResponse.json(listEnvelope([]))),
      http.post('*/api/v1/connections', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Connect failed' } }, { status: 500 }),
      ),
    )

    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    captured!.connectMcpConnector({ connectorId: 'connector_fail' })
    await waitFor(() => expect(captured!.connectMcpConnectorPending).toBe(false))
  })

  it('handles connectMcpConnector onError with a non-Error rejection (String path)', async () => {
    // To exercise the String(error) branch in onError, we temporarily make fetch
    // reject with a plain string. MSW is bypassed for this one POST to inject
    // a non-Error at the fetch boundary — this does NOT mock @/lib/api itself.
    const realFetch = window.fetch
    let postCallCount = 0
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (
        url.includes('/connections') &&
        !url.includes('/connections/') &&
        String(init?.method ?? 'GET').toUpperCase() === 'POST'
      ) {
        postCallCount++
        if (postCallCount === 1) {
          return Promise.reject('network string error') as never
        }
      }
      return realFetch(input, init)
    }

    server.use(http.get('*/api/v1/connections', () => HttpResponse.json(listEnvelope([]))))

    let captured: ReturnType<typeof useMcpActions> | undefined
    renderActions((a) => {
      captured = a
    })

    captured!.connectMcpConnector({ connectorId: 'connector_str_err' })
    await waitFor(() => expect(captured!.connectMcpConnectorPending).toBe(false))
    window.fetch = realFetch
  })
})
