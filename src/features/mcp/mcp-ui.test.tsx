import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connector } from '@/lib/api'
import { McpConnectorPage } from './McpConnectorPage'
import { McpPage } from './McpPage'
import { McpView } from './McpView'

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'github',
    name: 'GitHub',
    description: 'Repository MCP server.',
    category: 'development',
    trustLevel: 'verified',
    capabilities: ['repositories'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['github_token'],
    tools: [
      {
        name: 'repo.read',
        description: 'Read repository metadata.',
        inputSchema: {},
        approvalMode: 'project_policy',
        policyMetadata: {},
      },
    ],
    metadata: {},
    availability: 'available',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function page<T>(data: T[]) {
  return { data, pagination: { limit: 50, nextCursor: null, hasMore: false } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockJson(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]!
      const body = routes[path]
      return new Response(JSON.stringify(body ?? { error: { message: 'Not found' } }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

function pagination<T>(items: T[]) {
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
    previous: () => undefined,
    next: () => undefined,
    setPage: () => undefined,
    viewportRef: { current: null },
  }
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function withQueryClient(children: ReactNode) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>
}

describe('MCP catalog UI', () => {
  it('renders connector catalog rows', () => {
    render(
      <MemoryRouter>
        <McpView connectors={[connector()]} connectorPagination={pagination([connector()])} />
      </MemoryRouter>,
    )

    expect(screen.getByText('MCP connectors')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.getByText('repositories')).toBeTruthy()
    expect(screen.queryByText('Connections')).toBeNull()
  })

  it('loads the catalog page without querying project connection resources', async () => {
    mockJson({ '/api/v1/connectors': page([connector()]) })

    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp']}>
          <Routes>
            <Route path="/settings/mcp" element={<McpPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    expect(screen.queryByText('No project MCP connection resources exist.')).toBeNull()
  })

  it('renders connector detail from the catalog', async () => {
    mockJson({ '/api/v1/connectors/github': connector() })

    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/github']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    await waitFor(() => expect(screen.getByText('Repository MCP server.')).toBeTruthy())
    expect(screen.getByText('repo.read')).toBeTruthy()
    expect(screen.queryByText('Connect')).toBeNull()
    expect(screen.queryByText('Disconnect')).toBeNull()
  })
})
