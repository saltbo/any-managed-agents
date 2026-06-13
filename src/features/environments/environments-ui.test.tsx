import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { useClientPagination } from '@/console/use-client-pagination'
import { EnvironmentDetailView } from '@/features/environments/EnvironmentDetailView'
import { EnvironmentsView } from '@/features/environments/EnvironmentsView'
import type { Environment, Session } from '@/lib/api'
import { CreateEnvironmentSheet } from './CreateEnvironmentSheet'
import { EnvironmentDetailPage } from './EnvironmentDetailPage'
import { EnvironmentsPage } from './EnvironmentsPage'
import { useEnvironmentActions } from './use-environment-actions'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_1',
    projectId: 'project_1',
    name: 'Node workspace',
    description: 'Node 22 toolchain',
    packages: [{ name: 'vite', version: '7' }],
    variables: { NODE_ENV: { description: 'environment' } },
    credentialRefs: [{ credentialId: 'vaultcred_1' }],
    hostingMode: 'self_hosted',
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    mcpPolicy: {},
    packageManagerPolicy: {},
    resourceLimits: {},
    runtimeConfig: { image: 'node:22' },
    metadata: {},
    archivedAt: null,
    currentVersionId: 'envver_1',
    version: 2,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_1',
    projectId: 'project_1',
    environmentId: 'env_1',
  } as Session & typeof overrides
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// ─── EnvironmentsView ────────────────────────────────────────────────────────

describe('[spec: environments/console-list] EnvironmentsView', () => {
  it('explains the reusable-template empty state when no environments exist', () => {
    render(
      <MemoryRouter>
        <EnvironmentsView environments={[]} pagination={pagination<Environment>([])} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No environments')).toBeTruthy()
    expect(screen.getByText(/Create an execution environment before creating an agent\./)).toBeTruthy()
  })

  it('renders rows with name, status, hosting mode, runtime config, packages, network, and updated time', () => {
    const environments = [environment()]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    const cell = screen.getByText('Node workspace').closest('td')
    expect(cell).toBeTruthy()
    expect(screen.getByText('self_hosted')).toBeTruthy()
    expect(screen.getByText('node:22')).toBeTruthy()
    expect(screen.getByText('vite@7')).toBeTruthy()
    expect(screen.getByText('Restricted: registry.npmjs.org')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Node workspace' }).getAttribute('href')).toBe('/environments/env_1')
  })

  it('shows environment description in row when description is provided', () => {
    const environments = [environment({ description: 'My test desc' })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('My test desc')).toBeTruthy()
  })

  it('falls back to environment id when description is null', () => {
    const environments = [environment({ description: null })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('env_1')).toBeTruthy()
  })

  it('shows "archived" badge when environment is archived', () => {
    const environments = [environment({ archivedAt: '2026-05-24T00:00:00.000Z' })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('archived')).toBeTruthy()
  })

  it('shows "active" badge when environment is not archived', () => {
    const environments = [environment()]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('active')).toBeTruthy()
  })

  it('shows "None" when environment has no packages', () => {
    const environments = [environment({ packages: [] })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('None')).toBeTruthy()
  })

  it('renders package without version without the @ suffix', () => {
    const environments = [environment({ packages: [{ name: 'typescript' }] })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('typescript')).toBeTruthy()
  })

  it('shows unrestricted when network policy is unrestricted', () => {
    const environments = [environment({ networkPolicy: { mode: 'unrestricted' } })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('unrestricted')).toBeTruthy()
  })

  it('shows runtime config mode fallback when image is absent', () => {
    const environments = [environment({ runtimeConfig: { mode: 'sandbox' } })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('sandbox')).toBeTruthy()
  })

  it('shows Default when runtime config has no image or mode', () => {
    const environments = [environment({ runtimeConfig: {} })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Default')).toBeTruthy()
  })

  it('calls onArchive when archive confirm is submitted', async () => {
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

    const onArchive = vi.fn()
    const environments = [environment()]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={onArchive} />
      </MemoryRouter>,
    )

    // The icon button in the table row
    fireEvent.click(screen.getByRole('button', { name: 'Archive environment' }))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    // The confirm button inside the dialog (hidden=true to find it in the dialog overlay)
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    // Click the last one which is the dialog confirm button
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('env_1'))
  })

  it('paginates correctly with multiple environments', () => {
    const envs = Array.from({ length: 11 }, (_, i) => environment({ id: `env_${i + 1}`, name: `Env ${i + 1}` }))

    function Harness() {
      const pag = useClientPagination(envs)
      return (
        <MemoryRouter>
          <EnvironmentsView environments={pag.items} pagination={pag} onArchive={vi.fn()} />
        </MemoryRouter>
      )
    }

    render(<Harness />)
    expect(screen.getByText('1-10 of 11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('11-11 of 11')).toBeTruthy()
  })
})

// ─── EnvironmentDetailView ───────────────────────────────────────────────────

describe('[spec: environments/console-detail] EnvironmentDetailView', () => {
  it('shows the profile header and policy facts without raw secret values', () => {
    const session: Session = {
      id: 'session_1',
      projectId: 'project_1',
      environmentId: 'env_1',
    } as Session
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment()} sessions={[session]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Environment profile')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('self_hosted')).toBeTruthy()
    expect(screen.getByText('vaultcred_1')).toBeTruthy()
    expect(screen.getByText('Restricted: registry.npmjs.org')).toBeTruthy()
    expect(screen.getByText('Sessions using this environment')).toBeTruthy()
  })

  it('shows empty state when environment is null', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={null} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Environment not found')).toBeTruthy()
    expect(screen.getByText('The requested environment is not in the current project.')).toBeTruthy()
  })

  it('shows "No description" when description is null', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment({ description: null })} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No description')).toBeTruthy()
  })

  it('shows "None" for packages, variables, credential refs when all are empty', () => {
    const env = environment({ packages: [], variables: {}, credentialRefs: [] })
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={env} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    const nones = screen.getAllByText('None')
    expect(nones.length).toBeGreaterThanOrEqual(3)
  })

  it('shows unrestricted network policy in detail view', () => {
    const env = environment({ networkPolicy: { mode: 'unrestricted' } })
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={env} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('unrestricted')).toBeTruthy()
  })

  it('shows runtime config mode fallback when image is absent in detail view', () => {
    const env = environment({ runtimeConfig: { mode: 'sandbox' } })
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={env} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('sandbox')).toBeTruthy()
  })

  it('shows "Default" when runtimeConfig has no image or mode', () => {
    const env = environment({ runtimeConfig: {} })
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={env} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Default')).toBeTruthy()
  })

  it('only shows archive button for non-archived environment', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment()} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Archive')).toBeTruthy()
  })

  it('does not show archive button for archived environment', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView
          environment={environment({ archivedAt: '2026-05-24T00:00:00.000Z' })}
          sessions={[]}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByText('Archive')).toBeNull()
  })

  it('filters sessions to only those bound to the current environment', () => {
    const boundSession = { ...buildSession(), id: 'session_bound', environmentId: 'env_1' } as Session
    const otherSession = { ...buildSession(), id: 'session_other', environmentId: 'env_other' } as Session
    render(
      <MemoryRouter>
        <EnvironmentDetailView
          environment={environment()}
          sessions={[boundSession, otherSession]}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    // RelatedResourcesTable renders item.id as the link text for sessions
    // Only boundSession (environmentId === 'env_1') should appear in the table
    expect(screen.getAllByText('session_bound').length).toBeGreaterThan(0)
    expect(screen.queryByText('session_other')).toBeNull()
  })

  it('calls onArchive when archive confirm is submitted in detail view', async () => {
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

    const onArchive = vi.fn()
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment()} sessions={[]} onArchive={onArchive} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('Archive'))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('env_1'))
  })
})

// ─── CreateEnvironmentSheet ──────────────────────────────────────────────────

describe('[spec: environments/create-sheet] CreateEnvironmentSheet', () => {
  it('renders the create environment form when open', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Create Environment')).toBeTruthy()
    expect(screen.getByText('Define a reusable execution environment for future sessions.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save environment/i })).toBeTruthy()
  })

  it('does not render form content when closed', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open={false} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Create Environment')).toBeNull()
  })

  it('calls api.createEnvironment with restricted network policy on submit', async () => {
    const createEnvironment = vi.fn().mockResolvedValue({ id: 'env_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createEnvironment,
    } as never)

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(createEnvironment).toHaveBeenCalled())
    const arg = createEnvironment.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.name).toBe('Node workspace')
    expect((arg.networkPolicy as Record<string, unknown>).mode).toBe('restricted')
  })

  it('calls onOpenChange and resets form on successful environment creation', async () => {
    const createEnvironment = vi.fn().mockResolvedValue({ id: 'env_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createEnvironment,
    } as never)

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(createEnvironment).toHaveBeenCalled())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('handles api error on create without crashing (Error instance)', async () => {
    const createEnvironment = vi.fn().mockRejectedValue(new Error('Server error'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(createEnvironment).toHaveBeenCalled())
    // The onError handler fires toast.error — page should still render
    expect(screen.getByRole('button', { name: /Save environment/i })).toBeTruthy()
  })

  it('handles api error on create without crashing (non-Error value)', async () => {
    const createEnvironment = vi.fn().mockRejectedValue('string rejection')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(createEnvironment).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Save environment/i })).toBeTruthy()
  })

  it('sends unrestricted network policy when network mode is changed to unrestricted', async () => {
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

    const createEnvironment = vi.fn().mockResolvedValue({ id: 'env_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Change network mode from restricted to unrestricted via Radix Select
    const networkModeSelect = screen.getAllByRole('combobox')[1] as HTMLElement
    networkModeSelect.focus()
    fireEvent.pointerDown(networkModeSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(networkModeSelect)
    fireEvent.keyDown(networkModeSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Unrestricted' }))

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(createEnvironment).toHaveBeenCalled())
    const arg = createEnvironment.mock.calls[0]?.[0] as Record<string, unknown>
    expect((arg.networkPolicy as Record<string, unknown>).mode).toBe('unrestricted')
  })
})

// ─── EnvironmentsPage ────────────────────────────────────────────────────────

describe('[spec: environments/console-page] EnvironmentsPage', () => {
  async function setupPageWithEnvironments(envs: Environment[]) {
    const listEnvironments = vi.fn().mockResolvedValue({ data: envs })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listEnvironments,
      archiveEnvironment: vi.fn().mockResolvedValue({}),
    } as never)
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EnvironmentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { listEnvironments, client }
  }

  it('renders the page header and create environment button', async () => {
    await setupPageWithEnvironments([])
    expect(screen.getByText('Environments')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create environment/i })).toBeTruthy()
  })

  it('renders search, hosting filter, and status filter controls', async () => {
    await setupPageWithEnvironments([])
    expect(screen.getByRole('searchbox', { name: 'Search environments' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter by hosting mode' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy()
  })

  it('renders environment rows after data loads', async () => {
    await setupPageWithEnvironments([environment()])
    expect(await screen.findByText('Node workspace')).toBeTruthy()
  })

  it('filters environments by search text matching name', async () => {
    const envs = [environment({ id: 'env_1', name: 'Alpha env' }), environment({ id: 'env_2', name: 'Beta env' })]
    await setupPageWithEnvironments(envs)
    await screen.findByText('Alpha env')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search environments' }), {
      target: { value: 'Alpha' },
    })

    expect(screen.getByText('Alpha env')).toBeTruthy()
    expect(screen.queryByText('Beta env')).toBeNull()
  })

  it('filters environments by search text matching description', async () => {
    const envs = [
      environment({ id: 'env_1', name: 'Env 1', description: 'alpha workspace' }),
      environment({ id: 'env_2', name: 'Env 2', description: 'beta workspace' }),
    ]
    await setupPageWithEnvironments(envs)
    await screen.findByText('Env 1')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search environments' }), {
      target: { value: 'alpha' },
    })

    expect(screen.getByText('Env 1')).toBeTruthy()
    expect(screen.queryByText('Env 2')).toBeNull()
  })

  it('opens create environment sheet when button is clicked', async () => {
    await setupPageWithEnvironments([])
    fireEvent.click(screen.getByRole('button', { name: /Create environment/i }))
    await waitFor(() => expect(screen.getByText('Create Environment')).toBeTruthy())
  })

  it('shows empty state when no environments are returned', async () => {
    await setupPageWithEnvironments([])
    await waitFor(() => expect(screen.getByText('No environments')).toBeTruthy())
  })

  it('calls api.listEnvironments with archived=true when status filter is archived', async () => {
    const listEnvironments = vi.fn().mockResolvedValue({ data: [] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listEnvironments,
      archiveEnvironment: vi.fn().mockResolvedValue({}),
    } as never)
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/?status=archived']}>
          <EnvironmentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(listEnvironments).toHaveBeenCalledWith({ archived: true }))
  })

  it('filters environments by hosting mode when hosting filter is set', async () => {
    const envs = [
      environment({ id: 'env_cloud', name: 'Cloud env', hostingMode: 'cloud' }),
      environment({ id: 'env_self', name: 'Self env', hostingMode: 'self_hosted' }),
    ]
    const listEnvironments = vi.fn().mockResolvedValue({ data: envs })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listEnvironments,
      archiveEnvironment: vi.fn().mockResolvedValue({}),
    } as never)
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/?hosting=cloud']}>
          <EnvironmentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Cloud env')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Self env')).toBeNull())
  })

  it('shows archived environments when status filter is set to archived with matching data', async () => {
    const archivedEnv = environment({
      id: 'env_archived',
      name: 'Archived env',
      archivedAt: '2026-05-24T00:00:00.000Z',
    })
    const listEnvironments = vi.fn().mockResolvedValue({ data: [archivedEnv] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listEnvironments,
      archiveEnvironment: vi.fn().mockResolvedValue({}),
    } as never)
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/?status=archived']}>
          <EnvironmentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Archived env')).toBeTruthy()
    expect(screen.getAllByText('archived').length).toBeGreaterThan(0)
  })
})

// ─── EnvironmentDetailPage ───────────────────────────────────────────────────

describe('[spec: environments/console-detail-page] EnvironmentDetailPage', () => {
  async function setupDetailPage(env: Environment | null, sessions: Session[] = []) {
    const readEnvironment = vi.fn().mockResolvedValue(env)
    const listSessions = vi.fn().mockResolvedValue({ data: sessions })
    const archiveEnvironment = vi.fn().mockResolvedValue({})
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readEnvironment,
      listSessions,
      archiveEnvironment,
    } as never)
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { readEnvironment, listSessions, archiveEnvironment }
  }

  it('renders the page with environment name in header after load', async () => {
    await setupDetailPage(environment())
    expect(await screen.findByText('Node workspace')).toBeTruthy()
  })

  it('renders Environment detail fallback title when data is loading', async () => {
    await setupDetailPage(null)
    expect(screen.getByText('Environment detail')).toBeTruthy()
  })

  it('shows the edit environment button for an active environment', async () => {
    await setupDetailPage(environment())
    expect(await screen.findByRole('button', { name: /Edit environment/i })).toBeTruthy()
  })

  it('does not show the edit environment button for an archived environment', async () => {
    await setupDetailPage(environment({ archivedAt: '2026-05-24T00:00:00.000Z' }))
    await screen.findByText('Node workspace')
    expect(screen.queryByRole('button', { name: /Edit environment/i })).toBeNull()
  })

  it('opens the edit sheet when Edit environment is clicked', async () => {
    await setupDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
  })

  it('pre-fills the edit form with current environment values', async () => {
    await setupDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Node workspace')
      expect(nameInput).toBeTruthy()
    })
  })

  it('validates that name is required on edit form submit', async () => {
    await setupDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))

    const nameInput = screen.getByDisplayValue('Node workspace') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(screen.getByText('Name is required')).toBeTruthy())
  })

  it('calls api.updateEnvironment on valid edit form submit', async () => {
    const updateEnvironment = vi.fn().mockResolvedValue(environment())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readEnvironment: vi.fn().mockResolvedValue(environment()),
      listSessions: vi.fn().mockResolvedValue({ data: [] }),
      archiveEnvironment: vi.fn().mockResolvedValue({}),
      updateEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(updateEnvironment).toHaveBeenCalled())
  })

  it('clears name error when name is typed after a failed validation', async () => {
    await setupDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))

    const nameInput = screen.getByDisplayValue('Node workspace') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(screen.getByText('Name is required')).toBeTruthy())

    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'Fixed name' } })
    await waitFor(() => expect(screen.queryByText('Name is required')).toBeNull())
  })

  it('prefills edit form with environment name from current environment data', async () => {
    const env = environment({
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org', 'cdn.example.com'] },
    })
    await setupDetailPage(env)
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
    // The form should have the environment name pre-filled
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Node workspace')
      expect(nameInput).toBeTruthy()
    })
  })

  it('uses empty allowed hosts string when network policy is not restricted', async () => {
    const env = environment({ networkPolicy: { mode: 'unrestricted' } })
    await setupDetailPage(env)
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
    // form renders without the allowed hosts textarea when mode is not restricted
    expect(screen.queryByDisplayValue(/registry/)).toBeNull()
  })

  it('calls api.archiveEnvironment through the detail page archive flow', async () => {
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

    const archiveEnvironment = vi.fn().mockResolvedValue({})
    const readEnvironment = vi.fn().mockResolvedValue(environment())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readEnvironment,
      listSessions: vi.fn().mockResolvedValue({ data: [] }),
      archiveEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Node workspace')
    fireEvent.click(screen.getByText('Archive'))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(archiveEnvironment).toHaveBeenCalled())
    expect(archiveEnvironment.mock.calls[0]?.[0]).toBe('env_1')
  })

  it('handles api.archiveEnvironment Error rejection without crashing', async () => {
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

    const archiveEnvironment = vi.fn().mockRejectedValue(new Error('Archive failed'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readEnvironment: vi.fn().mockResolvedValue(environment()),
      listSessions: vi.fn().mockResolvedValue({ data: [] }),
      archiveEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Node workspace')
    fireEvent.click(screen.getByText('Archive'))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(archiveEnvironment).toHaveBeenCalled())
    // page still renders after error
    expect(screen.getByText('Node workspace')).toBeTruthy()
  })

  it('handles api.archiveEnvironment non-Error rejection without crashing', async () => {
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

    const archiveEnvironment = vi.fn().mockRejectedValue('string error')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readEnvironment: vi.fn().mockResolvedValue(environment()),
      listSessions: vi.fn().mockResolvedValue({ data: [] }),
      archiveEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Node workspace')
    fireEvent.click(screen.getByText('Archive'))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(archiveEnvironment).toHaveBeenCalled())
    expect(screen.getByText('Node workspace')).toBeTruthy()
  })

  it('pre-fills edit form from env with null description, no-version package, and value-type variable', async () => {
    const complexEnv = environment({
      description: null,
      packages: [{ name: 'typescript' }],
      variables: { SECRET: { value: 'hidden', description: 'secret val' } as unknown as { description?: string } },
      networkPolicy: { mode: 'unrestricted' },
    })
    await setupDetailPage(complexEnv)
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
    // Description is empty (null → '')
    const descInput = screen.getByDisplayValue('')
    expect(descInput).toBeTruthy()
    // Package without version uses 'latest'
    expect(screen.getByDisplayValue('typescript@latest')).toBeTruthy()
  })

  it('calls api.updateEnvironment with unrestricted policy when environment networkMode is unrestricted', async () => {
    const updateEnvironment = vi.fn().mockResolvedValue(environment())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readEnvironment: vi.fn().mockResolvedValue(environment({ networkPolicy: { mode: 'unrestricted' } })),
      listSessions: vi.fn().mockResolvedValue({ data: [] }),
      archiveEnvironment: vi.fn().mockResolvedValue({}),
      updateEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(updateEnvironment).toHaveBeenCalled())
    const arg = updateEnvironment.mock.calls[0]?.[1] as Record<string, unknown>
    expect((arg.networkPolicy as Record<string, unknown>).mode).toBe('unrestricted')
  })

  it('calls api.updateEnvironment and handles error without crashing', async () => {
    const updateEnvironment = vi.fn().mockRejectedValue(new Error('Update failed'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readEnvironment: vi.fn().mockResolvedValue(environment()),
      listSessions: vi.fn().mockResolvedValue({ data: [] }),
      archiveEnvironment: vi.fn().mockResolvedValue({}),
      updateEnvironment,
    } as never)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(updateEnvironment).toHaveBeenCalled())
    // The onError fires toast.error, page stays rendered
    expect(screen.getByRole('button', { name: /Save environment/i })).toBeTruthy()
  })
})

// ─── useEnvironmentActions ───────────────────────────────────────────────────

describe('[spec: environments/actions] useEnvironmentActions', () => {
  function ActionHarness({ onReady }: { onReady: (actions: ReturnType<typeof useEnvironmentActions>) => void }) {
    const actions = useEnvironmentActions()
    onReady(actions)
    return null
  }

  it('exposes archiveEnvironment function and archiveEnvironmentPending boolean as false initially', () => {
    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useEnvironmentActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(typeof capturedActions!.archiveEnvironment).toBe('function')
    expect(typeof capturedActions!.archiveEnvironmentPending).toBe('boolean')
    expect(capturedActions!.archiveEnvironmentPending).toBe(false)
  })
})
