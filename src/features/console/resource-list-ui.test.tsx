import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { McpView } from '@/features/mcp/McpView'
import type { Connection, Connector } from '@/lib/api'

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

describe('resource list UI contracts [spec: web-console/resource-lists]', () => {
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
