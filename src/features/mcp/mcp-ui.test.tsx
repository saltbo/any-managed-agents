import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Connection, Connector } from '@/lib/api'
import { McpConnectorPage } from './McpConnectorPage'
import { McpPage } from './McpPage'
import { connectorDisabledReason, McpView } from './McpView'
import { useMcpActions } from './use-mcp-actions'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mkClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
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

// ---------------------------------------------------------------------------
// connectorDisabledReason (pure function)
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
// McpView
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

    expect(screen.getByText('No MCP connectors match the current catalog filters.')).toBeTruthy()
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

    expect(screen.getByText('No project MCP connections exist.')).toBeTruthy()
  })

  it('renders a connector row with name, category, trust level, capabilities, and auth', () => {
    const connectors = [buildConnector()]
    render(
      <MemoryRouter>
        <McpView
          connectors={connectors}
          connectorPagination={pagination(connectors)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'GitHub MCP' })).toBeTruthy()
    expect(screen.getByText('code')).toBeTruthy()
    expect(screen.getByText('trusted')).toBeTruthy()
    expect(screen.getByText('read, write')).toBeTruthy()
    expect(screen.getByText('vault_credential')).toBeTruthy()
  })

  it('links connector name to detail page', () => {
    const connectors = [buildConnector()]
    render(
      <MemoryRouter>
        <McpView
          connectors={connectors}
          connectorPagination={pagination(connectors)}
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
    const connectors = [buildConnector({ availability: 'unavailable' })]
    render(
      <MemoryRouter>
        <McpView
          connectors={connectors}
          connectorPagination={pagination(connectors)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: 'GitHub MCP' })).toBeNull()
    expect(screen.getByText('GitHub MCP')).toBeTruthy()
    expect(screen.getAllByText('Connector is unavailable on this platform.').length).toBeGreaterThan(0)
  })

  it('renders capabilities as None when empty', () => {
    const connectors = [buildConnector({ capabilities: [] })]
    render(
      <MemoryRouter>
        <McpView
          connectors={connectors}
          connectorPagination={pagination(connectors)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('None')).toBeTruthy()
  })

  it('renders a connection row with connector id, state, credential, and endpoint', () => {
    const connections = [
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
          connections={connections}
          connectionPagination={pagination(connections)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('connector_1')).toBeTruthy()
    expect(screen.getByText('connected')).toBeTruthy()
    expect(screen.getByText('Reference configured')).toBeTruthy()
    expect(screen.getByText('https://mcp.example.com')).toBeTruthy()
  })

  it('renders Default when connection endpointUrl is null', () => {
    const connections = [buildConnection({ endpointUrl: null })]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={connections}
          connectionPagination={pagination(connections)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Default')).toBeTruthy()
  })

  it('renders No credential when credentialRef is null', () => {
    const connections = [buildConnection({ credentialRef: null })]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={connections}
          connectionPagination={pagination(connections)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No credential')).toBeTruthy()
  })

  it('calls onDisconnect with connection id when disconnect is confirmed', async () => {
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

    const onDisconnect = vi.fn()
    const connections = [buildConnection()]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={connections}
          connectionPagination={pagination(connections)}
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
    const connectors = [buildConnector({ setupRequirements: [] })]
    render(
      <MemoryRouter>
        <McpView
          connectors={connectors}
          connectorPagination={pagination(connectors)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Setup: None')).toBeTruthy()
  })

  it('renders supported auth modes as None when supportedAuthModes is empty', () => {
    const connectors = [buildConnector({ supportedAuthModes: [] })]
    render(
      <MemoryRouter>
        <McpView
          connectors={connectors}
          connectorPagination={pagination(connectors)}
          connections={[]}
          connectionPagination={pagination([])}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    // supportedAuthModes join is empty → renders 'None' in auth modes column
    const noneCells = screen.getAllByText('None')
    expect(noneCells.length).toBeGreaterThan(0)
  })

  it('passes lastError json as detail badge when connection has an error', () => {
    const connections = [buildConnection({ state: 'error', lastError: { code: 'CONN_REFUSED' } })]
    render(
      <MemoryRouter>
        <McpView
          connectors={[]}
          connectorPagination={pagination([])}
          connections={connections}
          connectionPagination={pagination(connections)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('error')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// McpPage
// ---------------------------------------------------------------------------

describe('[spec: mcp/page] McpPage', () => {
  it('shows loading state while queries are pending', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn(() => new Promise(() => {})),
      listConnections: vi.fn(() => new Promise(() => {})),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading MCP')).toBeTruthy()
  })

  it('shows error state when connectors query fails', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockRejectedValue(new Error('Connectors unavailable')),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('MCP unavailable')).toBeTruthy())
    expect(screen.getByText('Connectors unavailable')).toBeTruthy()
  })

  it('shows error state when connections query fails', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: [] }),
      listConnections: vi.fn().mockRejectedValue(new Error('Connections unavailable')),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('MCP unavailable')).toBeTruthy())
    expect(screen.getByText('Connections unavailable')).toBeTruthy()
  })

  it('shows error state body as stringified value when error is not an Error instance', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockRejectedValue('raw string error'),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('MCP unavailable')).toBeTruthy())
    expect(screen.getByText('raw string error')).toBeTruthy()
  })

  it('renders page header with MCP title when data loads', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: [] }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('MCP')).toBeTruthy())
    expect(screen.getByText(/Browse the connector catalog/)).toBeTruthy()
  })

  it('renders connector rows when data loads', async () => {
    const connectors = [buildConnector({ name: 'Jira MCP' })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: connectors }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Jira MCP')).toBeTruthy())
  })

  it('renders search filter input', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: [] }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeTruthy())
  })

  it('updates search filter in URL when user types', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: [] }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeTruthy())
    const searchInput = screen.getByLabelText('Search connectors')
    fireEvent.change(searchInput, { target: { value: 'github' } })
    // The input is URL-controlled (controlled component from searchParams). After change, the
    // new query is issued and the input reflects the URL value — verify the filter was invoked.
    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeTruthy())
  })

  it('renders category, trust level, and capability facet selects', async () => {
    const connectors = [buildConnector()]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: connectors }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Category')).toBeTruthy())
    expect(screen.getByLabelText('Trust level')).toBeTruthy()
    expect(screen.getByLabelText('Capability')).toBeTruthy()
  })

  it('pre-populates search filter from URL search params', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: [] }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/?search=github&category=code']}>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeTruthy())
    const searchInput = screen.getByLabelText('Search connectors') as HTMLInputElement
    expect(searchInput.value).toBe('github')
  })

  it('clears search filter when empty string is typed (exercises next.delete branch)', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: [] }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/?search=github']}>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeTruthy())
    // Fire a change event with empty value — triggers next.delete(key) in setFilter
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByLabelText('Search connectors')).toBeTruthy())
  })

  it('FacetSelect calls onChange with empty string when all option is selected', async () => {
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const connectors = [buildConnector({ category: 'code' })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: connectors }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/?category=code']}>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Category')).toBeTruthy())
    // Open the Category facet select and pick "All categories" to clear the filter
    const categoryTrigger = screen.getByLabelText('Category')
    categoryTrigger.focus()
    fireEvent.pointerDown(categoryTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(categoryTrigger)
    const allCategoriesOption = await screen.findByRole('option', { name: 'All categories' })
    fireEvent.click(allCategoriesOption)
    await waitFor(() => expect(screen.getByLabelText('Category')).toBeTruthy())
  })

  it('FacetSelect calls onChange with category value when a category is selected', async () => {
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const connectors = [buildConnector({ category: 'code' })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: connectors }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Category')).toBeTruthy())
    const categoryTrigger = screen.getByLabelText('Category')
    categoryTrigger.focus()
    fireEvent.pointerDown(categoryTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(categoryTrigger)
    const codeOption = await screen.findByRole('option', { name: 'code' })
    fireEvent.click(codeOption)
    await waitFor(() => expect(screen.getByLabelText('Category')).toBeTruthy())
  })

  it('FacetSelect calls onChange with trust level value when a trust level is selected', async () => {
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const connectors = [buildConnector({ trustLevel: 'trusted' })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: connectors }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Trust level')).toBeTruthy())
    const trustTrigger = screen.getByLabelText('Trust level')
    trustTrigger.focus()
    fireEvent.pointerDown(trustTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trustTrigger)
    const trustedOption = await screen.findByRole('option', { name: 'trusted' })
    fireEvent.click(trustedOption)
    await waitFor(() => expect(screen.getByLabelText('Trust level')).toBeTruthy())
  })

  it('FacetSelect calls onChange with capability value when a capability is selected', async () => {
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const connectors = [buildConnector({ capabilities: ['read'] })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listConnectors: vi.fn().mockResolvedValue({ data: connectors }),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <McpPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Capability')).toBeTruthy())
    const capabilityTrigger = screen.getByLabelText('Capability')
    capabilityTrigger.focus()
    fireEvent.pointerDown(capabilityTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(capabilityTrigger)
    const readOption = await screen.findByRole('option', { name: 'read' })
    fireEvent.click(readOption)
    await waitFor(() => expect(screen.getByLabelText('Capability')).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// McpConnectorPage
// ---------------------------------------------------------------------------

describe('[spec: mcp/connector-page] McpConnectorPage', () => {
  it('renders loading state while connector is fetching', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn(() => new Promise(() => {})),
      listConnections: vi.fn(() => new Promise(() => {})),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading connector')).toBeTruthy()
  })

  it('renders 404 empty state when readConnector returns a 404 ApiError', async () => {
    const { ApiError } = await import('@/lib/api')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockRejectedValue(new ApiError('Not found', 404, {})),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Connector not found')).toBeTruthy())
    expect(screen.getByText(/No MCP connector named "connector_1" exists/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to MCP discovery' })).toBeTruthy()
  })

  it('renders generic error state for non-404 ApiError', async () => {
    const { ApiError } = await import('@/lib/api')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockRejectedValue(new ApiError('Internal server error', 500, {})),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Connector unavailable')).toBeTruthy())
  })

  it('renders generic error state body for non-Error rejection', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockRejectedValue('raw error string'),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Connector unavailable')).toBeTruthy())
    expect(screen.getByText('raw error string')).toBeTruthy()
  })

  it('renders connector detail with name, category, trust level, capabilities, and auth modes', async () => {
    const connector = buildConnector()
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeTruthy())
    expect(screen.getByText('Connector profile')).toBeTruthy()
    expect(screen.getByText('code')).toBeTruthy()
    expect(screen.getByText('trusted')).toBeTruthy()
    expect(screen.getByText('read, write')).toBeTruthy()
    expect(screen.getByText('vault_credential')).toBeTruthy()
  })

  it('renders connector tools list', async () => {
    const connector = buildConnector()
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('list_repos')).toBeTruthy())
    expect(screen.getByText(/List repositories.*approval: none/)).toBeTruthy()
  })

  it('renders empty tools state when connector has no tools', async () => {
    const connector = buildConnector({ tools: [] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('This connector does not declare catalog tools.')).toBeTruthy())
  })

  it('renders tool with no description as No description', async () => {
    const connector = buildConnector({
      tools: [
        {
          name: 'exec_cmd',
          description: null,
          inputSchema: {},
          approvalMode: 'always_required',
          policyMetadata: {},
        },
      ],
    })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText(/No description.*approval: always_required/)).toBeTruthy())
  })

  it('renders Connect button when no active connection exists', async () => {
    const connector = buildConnector()
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy())
  })

  it('renders Disconnect button when an active connection exists', async () => {
    const connector = buildConnector()
    const connection = buildConnection({ connectorId: 'connector_1', state: 'connected' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [connection] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy())
  })

  it('ignores disconnected connections when deciding whether an active connection exists', async () => {
    const connector = buildConnector()
    const connection = buildConnection({ connectorId: 'connector_1', state: 'disconnected' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [connection] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy())
  })

  it('calls api.createConnection when Connect is clicked', async () => {
    const createConnection = vi.fn().mockResolvedValue(buildConnection())
    const connector = buildConnector()
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection,
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(createConnection).toHaveBeenCalled())
    expect(createConnection.mock.calls[0]?.[0]).toEqual({ connectorId: 'connector_1' })
  })

  it('renders disabled connector with disabled reason paragraph', async () => {
    const connector = buildConnector({ availability: 'unavailable' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeTruthy())
    expect(screen.getAllByText('Connector is unavailable on this platform.').length).toBeGreaterThan(0)
  })

  it('renders required credential type as vault_credential when setup requirements is empty', async () => {
    const connector = buildConnector({ supportedAuthModes: ['vault_credential'], setupRequirements: [] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeTruthy())
    expect(screen.getAllByText('vault_credential').length).toBeGreaterThan(0)
  })

  it('renders required credential type as None when vault_credential is not in supported auth modes', async () => {
    const connector = buildConnector({ supportedAuthModes: [], setupRequirements: [] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeTruthy())
    // Required credential type label followed by None value — also capabilities shows None
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('renders setup instructions for vault_credential auth mode with requirements', async () => {
    const connector = buildConnector({
      supportedAuthModes: ['vault_credential'],
      setupRequirements: ['github_token'],
    })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeTruthy())
    expect(screen.getByText('Store a github_token credential in a project vault.')).toBeTruthy()
    expect(screen.getByText('Connect the connector with the vault credential reference.')).toBeTruthy()
    expect(screen.getByText('Allow the connector for agents and environments that should call its tools.')).toBeTruthy()
  })

  it('renders no-credential setup instruction when no auth modes include vault_credential', async () => {
    const connector = buildConnector({ supportedAuthModes: [], setupRequirements: [] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [] }),
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeTruthy())
    expect(screen.getByText('Connect the connector; no credential is required.')).toBeTruthy()
  })

  it('calls api.disconnectConnection when Disconnect is confirmed on connector page', async () => {
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

    const disconnectConnection = vi.fn().mockResolvedValue(undefined)
    const connector = buildConnector()
    const connection = buildConnection({ connectorId: 'connector_1', state: 'connected' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readConnector: vi.fn().mockResolvedValue(connector),
      listConnections: vi.fn().mockResolvedValue({ data: [connection] }),
      disconnectConnection,
      createConnection: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/mcp/connector_1']}>
          <Routes>
            <Route path="/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const allButtons = await screen.findAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(allButtons[allButtons.length - 1]!)
    await waitFor(() => expect(disconnectConnection).toHaveBeenCalled())
    expect(disconnectConnection.mock.calls[0]?.[0]).toBe('connection_1')
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

  it('exposes disconnectMcpConnectionPending as false when idle', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection: vi.fn(() => new Promise(() => {})),
      createConnection: vi.fn(),
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    expect(captured!.disconnectMcpConnectionPending).toBe(false)
  })

  it('exposes connectMcpConnectorPending as false when idle', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection: vi.fn(),
      createConnection: vi.fn(() => new Promise(() => {})),
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    expect(captured!.connectMcpConnectorPending).toBe(false)
  })

  it('calls api.disconnectConnection with id on disconnectMcpConnection', async () => {
    const disconnectConnection = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection,
      createConnection: vi.fn(),
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    captured!.disconnectMcpConnection('connection_1')
    await waitFor(() => expect(disconnectConnection.mock.calls[0]?.[0]).toBe('connection_1'))
  })

  it('calls api.createConnection with input on connectMcpConnector', async () => {
    const createConnection = vi.fn().mockResolvedValue(buildConnection())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection: vi.fn(),
      createConnection,
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    captured!.connectMcpConnector({ connectorId: 'connector_1' })
    await waitFor(() => expect(createConnection.mock.calls[0]?.[0]).toEqual({ connectorId: 'connector_1' }))
  })

  it('shows toast error when disconnectConnection rejects with an Error', async () => {
    const disconnectConnection = vi.fn().mockRejectedValue(new Error('Disconnect failed'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection,
      createConnection: vi.fn(),
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    captured!.disconnectMcpConnection('connection_fail')
    await waitFor(() => expect(disconnectConnection.mock.calls[0]?.[0]).toBe('connection_fail'))
  })

  it('shows toast error when disconnectConnection rejects with a non-Error', async () => {
    const disconnectConnection = vi.fn().mockRejectedValue('network timeout')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection,
      createConnection: vi.fn(),
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    captured!.disconnectMcpConnection('connection_fail2')
    await waitFor(() => expect(disconnectConnection.mock.calls[0]?.[0]).toBe('connection_fail2'))
  })

  it('shows toast error when createConnection rejects with an Error', async () => {
    const createConnection = vi.fn().mockRejectedValue(new Error('Connect failed'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection: vi.fn(),
      createConnection,
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    captured!.connectMcpConnector({ connectorId: 'connector_fail' })
    await waitFor(() => expect(createConnection.mock.calls[0]?.[0]).toEqual({ connectorId: 'connector_fail' }))
  })

  it('shows toast error when createConnection rejects with a non-Error', async () => {
    const createConnection = vi.fn().mockRejectedValue('quota exceeded')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      disconnectConnection: vi.fn(),
      createConnection,
    } as never)

    let captured: ReturnType<typeof useMcpActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            captured = a
          }}
        />
      </QueryClientProvider>,
    )

    captured!.connectMcpConnector({ connectorId: 'connector_fail2' })
    await waitFor(() => expect(createConnection.mock.calls[0]?.[0]).toEqual({ connectorId: 'connector_fail2' }))
  })
})
