import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { McpView } from '@/features/mcp/McpView'
import { ProvidersView } from '@/features/providers/ProvidersView'
import type { Connection, Connector, Provider } from '@/lib/api'

afterEach(() => {
  cleanup()
})

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

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'workers-ai',
    projectId: 'project_1',
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: true,
    enabled: false,
    credentialRef: null,
    credentialStatus: 'missing',
    metadata: {},
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogState: 'error',
    lastError: { message: 'Catalog failed' },
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'github',
    name: 'GitHub',
    description: 'Repository access',
    category: 'source-control',
    trustLevel: 'official',
    capabilities: ['repo'],
    supportedAuthModes: ['api_key'],
    setupRequirements: ['credential'],
    tools: [
      {
        name: 'repo.read',
        description: 'Read repository',
        inputSchema: {},
        approvalMode: 'project_policy',
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

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'mcpconn_1',
    projectId: 'project_1',
    connectorId: 'github',
    credentialRef: { credentialId: 'vaultcred_1' },
    endpointUrl: null,
    approvalMode: 'project_policy',
    state: 'error',
    lastError: { message: 'Connection failed' },
    metadata: {},
    connectedAt: '2026-05-23T00:00:00.000Z',
    disconnectedAt: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

describe('resource list UI contracts', () => {
  it('renders provider rows on one line with tooltip-backed error details', () => {
    const providers = [provider()]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    const providerCell = screen.getByText('Workers AI').closest('td')
    expect(providerCell).toBeTruthy()
    expect(within(providerCell as HTMLElement).getByText('workers-ai')).toBeTruthy()
    expect(providerCell?.querySelector('p')).toBeNull()
    expect(screen.getByLabelText(/disabled: .*Catalog failed/)).toBeTruthy()
    expect(screen.getByText('1-1 of 1')).toBeTruthy()
  })

  it('renders MCP rows on one line with tooltip-backed connection errors', () => {
    const connectors = [connector()]
    const connections = [connection()]
    render(
      <MemoryRouter>
        <McpView
          connectors={connectors}
          connectorPagination={pagination(connectors)}
          connections={connections}
          connectionPagination={pagination(connections)}
          onDisconnect={vi.fn()}
        />
      </MemoryRouter>,
    )

    const connectorCell = screen.getByText('GitHub').closest('td')
    expect(connectorCell).toBeTruthy()
    expect(connectorCell?.querySelector('p')).toBeNull()
    expect(screen.getByLabelText(/error: .*Connection failed/)).toBeTruthy()
    expect(screen.getAllByText('1-1 of 1')).toHaveLength(2)
  })
})
