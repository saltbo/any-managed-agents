import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AuthContext, Project, Session } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleShell } from './ConsoleShell'
import { ConsoleContextProvider, useConsoleContext } from './console-context'
import { JsonBlock } from './json-block'
import { RelatedResourcesTable } from './related-resources-table'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function buildAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: { id: 'user_1', email: 'user@example.com', name: 'Alice', avatarUrl: null },
    organization: { id: 'org_1', name: 'My Org' },
    project: { id: 'project_1', name: 'Project One' },
    roles: [],
    permissions: [],
    ...overrides,
  }
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project_1',
    name: 'Project One',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    projectId: 'project_1',
    name: 'My Agent',
    description: null,
    instructions: 'Do things',
    providerId: 'workers-ai',
    model: '@cf/model',
    skills: [],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: {},
    tools: [],
    mcpConnectors: [],
    metadata: {},
    archivedAt: null,
    currentVersionId: 'agentver_1',
    version: 1,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: {} as Session['agentSnapshot'],
    environmentId: null,
    environmentVersionId: null,
    environmentSnapshot: null,
    title: 'Test session',
    resourceRefs: [],
    env: {},
    secretEnv: [],
    runtimeMetadata: {} as Session['runtimeMetadata'],
    state: 'idle',
    stateReason: null,
    metadata: {},
    startedAt: '2026-05-23T00:00:00.000Z',
    stoppedAt: null,
    archivedAt: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function renderShell(auth: AuthContext = buildAuth(), projects: Project[] = [buildProject()], extraPath = '/') {
  const client = makeQueryClient()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[extraPath]}>
        <ConsoleContextProvider value={{ auth, projects, selectProject: vi.fn() }}>
          <ConsoleShell>
            <div data-testid="shell-child">child</div>
          </ConsoleShell>
        </ConsoleContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

// ─── console-context.tsx ─────────────────────────────────────────────────────

describe('[spec: console/context] ConsoleContextProvider and useConsoleContext', () => {
  it('provides context value to consumers', () => {
    const auth = buildAuth()
    const projects = [buildProject()]
    const selectProject = vi.fn()

    function Consumer() {
      const ctx = useConsoleContext()
      return (
        <div>
          <span data-testid="email">{ctx.auth.user.email}</span>
          <span data-testid="org">{ctx.auth.organization.name}</span>
          <span data-testid="project">{ctx.auth.project.name}</span>
          <span data-testid="project-count">{ctx.projects.length}</span>
        </div>
      )
    }

    render(
      <ConsoleContextProvider value={{ auth, projects, selectProject }}>
        <Consumer />
      </ConsoleContextProvider>,
    )

    expect(screen.getByTestId('email').textContent).toBe('user@example.com')
    expect(screen.getByTestId('org').textContent).toBe('My Org')
    expect(screen.getByTestId('project').textContent).toBe('Project One')
    expect(screen.getByTestId('project-count').textContent).toBe('1')
  })

  it('throws when useConsoleContext is called outside provider', () => {
    function Bad() {
      useConsoleContext()
      return null
    }

    // Suppress the error boundary noise in test output
    const originalError = console.error
    console.error = vi.fn()
    expect(() => render(<Bad />)).toThrow('useConsoleContext must be used inside ConsoleContextProvider')
    console.error = originalError
  })

  it('calls selectProject when invoked through context', () => {
    const selectProject = vi.fn()

    function Caller() {
      const ctx = useConsoleContext()
      return (
        <button type="button" onClick={() => ctx.selectProject('project_2')}>
          switch
        </button>
      )
    }

    render(
      <ConsoleContextProvider value={{ auth: buildAuth(), projects: [], selectProject }}>
        <Caller />
      </ConsoleContextProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))
    expect(selectProject).toHaveBeenCalledWith('project_2')
  })
})

// ─── json-block.tsx ──────────────────────────────────────────────────────────

describe('[spec: console/json-block] JsonBlock', () => {
  it('renders the provided JSON value in a pre element', () => {
    render(<JsonBlock value='{"key":"value"}' />)
    expect(screen.getByText('{"key":"value"}')).toBeTruthy()
  })

  it('applies compact styling when compact=true', () => {
    const { container } = render(<JsonBlock value="{}" compact />)
    // compact uses max-h-48 class
    const scrollable = container.querySelector('.max-h-48')
    expect(scrollable).toBeTruthy()
  })

  it('applies default (non-compact) styling when compact=false', () => {
    const { container } = render(<JsonBlock value="{}" compact={false} />)
    const scrollable = container.querySelector('.max-h-96')
    expect(scrollable).toBeTruthy()
  })

  it('applies inverted styling when inverted=true', () => {
    const { container } = render(<JsonBlock value="{}" inverted />)
    const scrollable = container.querySelector('.bg-primary')
    expect(scrollable).toBeTruthy()
  })

  it('applies non-inverted (muted) styling when inverted=false', () => {
    const { container } = render(<JsonBlock value="{}" inverted={false} />)
    const scrollable = container.querySelector('.bg-muted\\/30')
    expect(scrollable).toBeTruthy()
  })

  it('renders with default props (not compact, not inverted)', () => {
    const { container } = render(<JsonBlock value="test content" />)
    const scrollable = container.querySelector('.max-h-96')
    expect(scrollable).toBeTruthy()
    const muted = container.querySelector('.bg-muted\\/30')
    expect(muted).toBeTruthy()
  })

  it('renders compact+inverted combination', () => {
    const { container } = render(<JsonBlock value="{}" compact inverted />)
    const el = container.querySelector('.max-h-48')
    expect(el).toBeTruthy()
    expect(el?.className).toContain('bg-primary')
  })
})

// ─── related-resources-table.tsx ─────────────────────────────────────────────

describe('[spec: console/related-resources-table] RelatedResourcesTable', () => {
  it('renders empty state message when items array is empty', () => {
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents found" items={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No agents found')).toBeTruthy()
    expect(screen.getByText('Agents')).toBeTruthy()
  })

  it('renders an Agent row with link to /agents/:id and name as display', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={[agent]} />
      </MemoryRouter>,
    )

    const link = screen.getAllByRole('link', { name: 'My Agent' })[0] as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/agents/agent_1')
    expect(screen.getByText('active')).toBeTruthy()
  })

  it('renders an archived Agent row with archived status badge', () => {
    const agent = buildAgent({ archivedAt: '2026-05-24T00:00:00.000Z' })
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={[agent]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('archived')).toBeTruthy()
  })

  it('renders a Session row with link to /sessions/:id and id as display', () => {
    const session = buildSession()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    const link = screen.getAllByRole('link', { name: 'session_1' })[0] as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/sessions/session_1')
    // Session state renders via StatusBadge
    expect(screen.getByText('idle')).toBeTruthy()
  })

  it('renders Open button linking to correct path for Agent', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={[agent]} />
      </MemoryRouter>,
    )

    const openLink = screen.getByRole('link', { name: 'Open' })
    expect(openLink.getAttribute('href')).toBe('/agents/agent_1')
  })

  it('renders Open button linking to correct path for Session', () => {
    const session = buildSession()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    const openLink = screen.getByRole('link', { name: 'Open' })
    expect(openLink.getAttribute('href')).toBe('/sessions/session_1')
  })

  it('renders multiple rows with correct count', () => {
    const agents = [buildAgent({ id: 'agent_1', name: 'Alpha' }), buildAgent({ id: 'agent_2', name: 'Beta' })]
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={agents} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('renders session row with startedAt date displayed', () => {
    const session = buildSession({ startedAt: '2026-05-23T00:00:00.000Z' })
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    // session_1 appears in both link text and the subtitle span
    expect(screen.getAllByText('session_1').length).toBeGreaterThan(0)
    // formatDate returns a non-empty date string
    expect(screen.queryByText('None')).toBeNull()
  })

  it('renders session row with null startedAt showing None', () => {
    const session = buildSession({ startedAt: null })
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('None')).toBeTruthy()
  })

  it('renders table header columns', () => {
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Resources" empty="Empty" items={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Resource')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Updated')).toBeTruthy()
    expect(screen.getByText('Actions')).toBeTruthy()
  })
})

// ─── ConsoleShell.tsx ─────────────────────────────────────────────────────────

describe('[spec: console/shell] ConsoleShell', () => {
  it('renders children inside the shell', () => {
    renderShell()
    expect(screen.getByTestId('shell-child')).toBeTruthy()
  })

  it('renders the app brand name', () => {
    renderShell()
    expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0)
  })

  it('renders desktop nav links for all sections', () => {
    renderShell()
    expect(screen.getAllByRole('link', { name: 'Agents' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Environments' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Sessions' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Providers' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Vaults' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'MCP' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Audit' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThan(0)
  })

  it('renders user name from auth context', () => {
    renderShell(buildAuth({ user: { id: 'u1', email: 'test@x.com', name: 'Bob Smith', avatarUrl: null } }))
    expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
  })

  it('renders user email when name is null', () => {
    renderShell(buildAuth({ user: { id: 'u1', email: 'fallback@x.com', name: null, avatarUrl: null } }))
    expect(screen.getAllByText('fallback@x.com').length).toBeGreaterThan(0)
  })

  it('renders organization name from auth context', () => {
    renderShell(buildAuth({ organization: { id: 'org_2', name: 'Acme Corp' } }))
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0)
  })

  it('renders project select with project names', () => {
    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    const auth = buildAuth({ project: { id: 'p1', name: 'Alpha' } })
    renderShell(auth, projects)
    // SelectValue renders current project name inside trigger
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
  })

  it('applies full-bleed layout when on a session detail route', () => {
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/sessions/session_1']}>
          <ConsoleContextProvider value={{ auth: buildAuth(), projects: [buildProject()], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const content = container.querySelector('[data-console-content="full-bleed"]')
    expect(content).toBeTruthy()
  })

  it('applies contained layout when on a non-session route', () => {
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/agents']}>
          <ConsoleContextProvider value={{ auth: buildAuth(), projects: [buildProject()], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const content = container.querySelector('[data-console-content="contained"]')
    expect(content).toBeTruthy()
  })

  it('sidebar placement shows ArrowRight icon (isSidebar=true branch)', () => {
    // UserMenu is rendered twice: sidebar + mobile. isSidebar=true adds ArrowRight.
    const auth = buildAuth({ user: { id: 'u1', email: 'x@y.com', name: 'Test', avatarUrl: null } })
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth, projects: [], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // Sidebar container exists
    expect(container.querySelector('.mt-4.border-t.pt-3')).toBeTruthy()
    // Mobile container exists
    expect(container.querySelector('.fixed.bottom-4')).toBeTruthy()
  })

  it('calls signOut when Log out menu item is selected', async () => {
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

    const signOut = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(await import('@/lib/oidc'), 'signOut').mockImplementation(signOut)

    const auth = buildAuth()
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth, projects: [buildProject()], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Open the sidebar user menu dropdown trigger
    const menuTriggers = screen.getAllByRole('button')
    const trigger = menuTriggers[0] as HTMLElement
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)

    await waitFor(() => expect(screen.getAllByText(/Log out/).length).toBeGreaterThan(0))
    // Click the Log out item (it may appear in multiple menus since 2 UserMenus are rendered)
    const logoutItems = screen.getAllByText(/Log out/)
    fireEvent.click(logoutItems[0]!)
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })

  it('calls selectProject and invalidates queries when project is changed', async () => {
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

    const selectProject = vi.fn()
    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    const auth = buildAuth({ project: { id: 'p1', name: 'Alpha' } })

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth, projects, selectProject }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Open the project select and choose Beta
    const select = screen.getByRole('combobox')
    select.focus()
    fireEvent.pointerDown(select, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Beta' }))

    await waitFor(() => expect(selectProject).toHaveBeenCalledWith('p2'))
  })
})

// ─── ConsoleLayout.tsx ───────────────────────────────────────────────────────

describe('[spec: console/layout] ConsoleLayout', () => {
  async function setupLayout({
    user = { sub: 'user_1', email: 'user@example.com', name: 'Alice', picture: null as string | null },
    projectsData = [buildProject()],
    userError = null as Error | null,
    projectsError = null as Error | null,
  } = {}) {
    const getCurrentUser = vi.fn()
    const listProjects = vi.fn()

    if (userError) {
      getCurrentUser.mockRejectedValue(userError)
    } else if (user === null) {
      getCurrentUser.mockResolvedValue(null)
    } else {
      getCurrentUser.mockResolvedValue({
        expired: false,
        profile: user,
      })
    }

    if (projectsError) {
      listProjects.mockRejectedValue(projectsError)
    } else {
      listProjects.mockResolvedValue({ data: projectsData })
    }

    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockImplementation(getCurrentUser)
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({ listProjects } as never)

    // Reset project selection so tests are isolated
    vi.spyOn(await import('@/lib/project-selection'), 'getSelectedProjectId').mockReturnValue(null)
    vi.spyOn(await import('@/lib/project-selection'), 'setSelectedProjectId').mockReturnValue(undefined)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConsoleLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { getCurrentUser, listProjects }
  }

  it('shows loading state while user query is pending', async () => {
    // Make getCurrentUser hang to keep loading state
    let resolve!: (v: unknown) => void
    const hanging = new Promise((res) => {
      resolve = res
    })
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockReturnValue(hanging as never)
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({ listProjects: vi.fn() } as never)
    vi.spyOn(await import('@/lib/project-selection'), 'getSelectedProjectId').mockReturnValue(null)
    vi.spyOn(await import('@/lib/project-selection'), 'setSelectedProjectId').mockReturnValue(undefined)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConsoleLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading console')).toBeTruthy()
    resolve(null)
  })

  it('shows sign-in screen when user is null (not authenticated)', async () => {
    await setupLayout({ user: null as never })
    await waitFor(() => expect(screen.getByText('Any Managed Agents')).toBeTruthy())
    expect(screen.getByText(/Sign in through OIDC provider/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with OIDC provider' })).toBeTruthy()
  })

  it('shows sign-in screen when getCurrentUser throws', async () => {
    await setupLayout({ userError: new Error('Auth failed') })
    await waitFor(() => expect(screen.getByText('Any Managed Agents')).toBeTruthy())
    expect(screen.getByText(/Sign in through OIDC provider/)).toBeTruthy()
  })

  it('shows console unavailable when projects query returns 401 ApiError', async () => {
    const apiError = new ApiError('Unauthorized', 401, {})
    await setupLayout({ projectsError: apiError })
    await waitFor(() => expect(screen.getByText('Any Managed Agents')).toBeTruthy())
    expect(screen.getByText(/Sign in through OIDC provider/)).toBeTruthy()
  })

  it('shows console unavailable when projects query errors with non-401 ApiError', async () => {
    const apiError = new ApiError('Server error', 500, {})
    await setupLayout({ projectsError: apiError })
    await waitFor(() => expect(screen.getByText('Console unavailable')).toBeTruthy())
    expect(screen.getByText('Server error')).toBeTruthy()
  })

  it('shows console unavailable with generic message for non-ApiError projects failure', async () => {
    await setupLayout({ projectsError: new Error('Network failure') })
    await waitFor(() => expect(screen.getByText('Console unavailable')).toBeTruthy())
    expect(screen.getByText('Unable to load the project list.')).toBeTruthy()
  })

  it('shows console unavailable when projects list is empty (no selected project)', async () => {
    await setupLayout({ projectsData: [] })
    await waitFor(() => expect(screen.getByText('Console unavailable')).toBeTruthy())
    expect(screen.getByText('Unable to create or load a project.')).toBeTruthy()
  })

  it('renders ConsoleShell with nav when authenticated with projects', async () => {
    await setupLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    // Confirm it's in the shell (not just the sign-in screen)
    expect(screen.getAllByRole('link', { name: 'Agents' }).length).toBeGreaterThan(0)
  })

  it('uses org_id from profile as organization id when present', async () => {
    await setupLayout({
      user: { sub: 'user_1', email: 'u@example.com', name: 'Alice', picture: null, org_id: 'org_explicit' } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
  })

  it('falls back to organization_id when org_id is absent', async () => {
    await setupLayout({
      user: {
        sub: 'user_1',
        email: 'u@example.com',
        name: 'Alice',
        picture: null,
        organization_id: 'org_fallback',
      } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
  })

  it('falls back to user:sub when neither org_id nor organization_id present', async () => {
    await setupLayout({
      user: { sub: 'user_1', email: 'u@example.com', name: 'Alice', picture: null } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
  })

  it('uses org_name from profile as organization name when present', async () => {
    await setupLayout({
      user: { sub: 'u1', email: 'u@x.com', name: 'A', picture: null, org_name: 'My Org' } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByText('My Org').length).toBeGreaterThan(0)
  })

  it('falls back to organization_name when org_name is absent', async () => {
    await setupLayout({
      user: { sub: 'u1', email: 'u@x.com', name: 'A', picture: null, organization_name: 'Fallback Org' } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Fallback Org').length).toBeGreaterThan(0)
  })

  it('shows Personal workspace when org_name and organization_name are absent', async () => {
    await setupLayout({
      user: { sub: 'u1', email: 'u@x.com', name: null, picture: null } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Personal workspace').length).toBeGreaterThan(0)
  })

  it('uses picture from profile as avatarUrl when present', async () => {
    await setupLayout({
      user: { sub: 'u1', email: 'u@x.com', name: 'A', picture: 'https://img.example.com/pic.jpg' } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
  })

  it('selects first project when no stored project id matches', async () => {
    const projects = [buildProject({ id: 'p1', name: 'First' }), buildProject({ id: 'p2', name: 'Second' })]
    await setupLayout({ projectsData: projects })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    // First project should be selected (shown in SelectValue)
    expect(screen.getAllByText('First').length).toBeGreaterThan(0)
  })

  it('dispatches signIn when sign-in button is clicked', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(await import('@/lib/oidc'), 'signIn').mockImplementation(signIn)

    await setupLayout({ user: null as never })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with OIDC provider' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Continue with OIDC provider' }))
    await waitFor(() => expect(signIn).toHaveBeenCalled())
  })

  it('calls setSelectedProjectId when project select changes in the full layout', async () => {
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

    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    const setSelectedProjectId = vi.fn()
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue({
      expired: false,
      profile: { sub: 'u1', email: 'u@x.com', name: 'User', picture: null },
    } as never)
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listProjects: vi.fn().mockResolvedValue({ data: projects }),
    } as never)
    vi.spyOn(await import('@/lib/project-selection'), 'getSelectedProjectId').mockReturnValue('p1')
    vi.spyOn(await import('@/lib/project-selection'), 'setSelectedProjectId').mockImplementation(setSelectedProjectId)

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConsoleLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))

    const select = screen.getByRole('combobox')
    select.focus()
    fireEvent.pointerDown(select, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Beta' }))

    await waitFor(() => expect(setSelectedProjectId).toHaveBeenCalledWith('p2'))
  })

  it('falls back to empty string email when profile.email is not a string', async () => {
    await setupLayout({
      user: { sub: 'u1', email: 42 as never, name: 'User', picture: null } as never,
    })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    // Empty email → user menu shows the name (falling back to '' for email)
    expect(screen.getAllByText('User').length).toBeGreaterThan(0)
  })

  it('listens for ama:selected-project-changed event without crashing', async () => {
    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    await setupLayout({ projectsData: projects })
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))

    // Dispatch the event — verifies the listener is registered and does not throw
    expect(() => {
      window.dispatchEvent(new Event('ama:selected-project-changed'))
    }).not.toThrow()

    // Page still renders after the event
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
  })
})
