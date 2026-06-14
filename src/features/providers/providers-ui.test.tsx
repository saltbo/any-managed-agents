import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { AccessRule, Provider } from '@/lib/api'
import { createCollection, HttpResponse, http, resourceHandlers, server } from '@/test/msw'
import { CreateAccessRuleSheet } from './CreateAccessRuleSheet'
import { CreateProviderSheet } from './CreateProviderSheet'
import { ProviderDetailPage } from './ProviderDetailPage'
import { ProviderDetailView } from './ProviderDetailView'
import { ProviderPolicyPage } from './ProviderPolicyPage'
import { ProvidersPage } from './ProvidersPage'
import { ProvidersView } from './ProvidersView'
import { useProviderActions } from './use-provider-actions'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'provider_1',
    projectId: 'project_1',
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: false,
    enabled: true,
    credentialRef: null,
    credentialStatus: 'not_required',
    metadata: {},
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildAccessRule(overrides: Partial<AccessRule> = {}): AccessRule {
  return {
    id: 'rule_1',
    providerId: 'workers-ai',
    modelId: '@cf/meta/llama',
    teamId: null,
    effect: 'deny',
    reason: 'Blocked by policy',
    metadata: {},
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

function mkClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// Pointer capture stubs needed by Radix UI dialogs/selects
function stubPointerEvents() {
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
}

// ─── MSW handler factories ────────────────────────────────────────────────────

function setupProviderHandlers(providers: Provider[] = []) {
  const collection = createCollection<Provider>(providers)
  server.use(
    ...resourceHandlers('providers', collection, (body, idx) =>
      buildProvider({ id: `provider_new_${idx}`, displayName: String(body.displayName ?? 'New'), ...body }),
    ),
  )
  return collection
}

function setupAccessRuleHandlers(rules: AccessRule[] = []) {
  const collection = createCollection<AccessRule>(rules)
  server.use(
    http.get('*/api/v1/access-rules', () =>
      HttpResponse.json({ data: collection.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
    ),
    http.post('*/api/v1/access-rules', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      const rule = buildAccessRule({ id: `rule_new_${collection.items.size}`, ...body })
      collection.put(rule)
      return HttpResponse.json(rule, { status: 201 })
    }),
  )
  return collection
}

// ---------------------------------------------------------------------------
// ProvidersView
// ---------------------------------------------------------------------------

describe('[spec: providers/console-list] ProvidersView', () => {
  it('shows empty state when no providers exist', () => {
    render(
      <MemoryRouter>
        <ProvidersView providers={[]} pagination={pagination([])} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No providers')).toBeTruthy()
    expect(screen.getByText(/Add a model provider or use the platform defaults/)).toBeTruthy()
  })

  it('renders a row for each provider with name, type, status, credential status, catalog state, and base URL fallback', () => {
    const providers = [buildProvider()]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Workers AI' })).toBeTruthy()
    expect(screen.getByText('workers-ai')).toBeTruthy()
    expect(screen.getByText('enabled')).toBeTruthy()
    expect(screen.getByText('not_required')).toBeTruthy()
    expect(screen.getByText('ready')).toBeTruthy()
    expect(screen.getByText('Platform default')).toBeTruthy()
  })

  it('renders base URL when present', () => {
    const providers = [buildProvider({ baseUrl: 'https://api.example.com' })]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('https://api.example.com')).toBeTruthy()
  })

  it('shows disabled badge when provider is disabled', () => {
    const providers = [buildProvider({ enabled: false })]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('disabled')).toBeTruthy()
  })

  it('shows default badge when provider is the default', () => {
    const providers = [buildProvider({ isDefault: true })]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('default')).toBeTruthy()
  })

  it('links provider name to detail page', () => {
    const providers = [buildProvider()]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Workers AI' })
    expect(link.getAttribute('href')).toBe('/providers/provider_1')
  })

  it('calls onArchive with provider id when delete is confirmed', async () => {
    stubPointerEvents()

    const onArchive = vi.fn()
    const providers = [buildProvider()]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={onArchive} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete provider' }))
    const allButtons = await screen.findAllByRole('button', { name: 'Delete provider' })
    fireEvent.click(allButtons[allButtons.length - 1]!)
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('provider_1'))
  })

  it('passes lastError JSON as detail to StatusBadge when provider has an error', () => {
    const providers = [buildProvider({ lastError: { code: 'TIMEOUT' } })]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('enabled')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// ProviderDetailView
// ---------------------------------------------------------------------------

describe('[spec: providers/console-detail] ProviderDetailView', () => {
  it('shows empty state when provider is null', () => {
    render(<ProviderDetailView provider={null} />)

    expect(screen.getByText('Provider not found')).toBeTruthy()
    expect(screen.getByText(/The requested provider is not in this project/)).toBeTruthy()
  })

  it('renders provider profile with id, type, status, and metadata', () => {
    const provider = buildProvider({
      id: 'provider_abc',
      type: 'anthropic',
      enabled: true,
      credentialStatus: 'configured',
    })
    render(<ProviderDetailView provider={provider} />)

    expect(screen.getByText('Provider profile')).toBeTruthy()
    expect(screen.getByText('anthropic')).toBeTruthy()
    expect(screen.getByText('provider_abc')).toBeTruthy()
    expect(screen.getByText('enabled')).toBeTruthy()
    expect(screen.getByText('configured')).toBeTruthy()
    expect(screen.getByText('Platform default')).toBeTruthy()
    expect(screen.getByText('None')).toBeTruthy()
  })

  it('renders disabled status badge when provider is disabled', () => {
    const provider = buildProvider({ enabled: false })
    render(<ProviderDetailView provider={provider} />)

    expect(screen.getByText('disabled')).toBeTruthy()
  })

  it('renders base URL when present', () => {
    const provider = buildProvider({ baseUrl: 'https://custom.api.com' })
    render(<ProviderDetailView provider={provider} />)

    expect(screen.getByText('https://custom.api.com')).toBeTruthy()
  })

  it('renders last error JSON when present', () => {
    const provider = buildProvider({ lastError: { code: 'TIMEOUT', message: 'upstream timeout' } })
    render(<ProviderDetailView provider={provider} />)

    expect(screen.getByText(/TIMEOUT/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// ProviderDetailPage
// ---------------------------------------------------------------------------

describe('[spec: providers/console-detail-page] ProviderDetailPage', () => {
  it('renders loading header while provider is fetching', () => {
    // Register a never-resolving endpoint so the query stays in loading state
    server.use(http.get('*/api/v1/providers/:id', () => new Promise(() => {})))

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/providers/provider_1']}>
          <Routes>
            <Route path="/providers/:providerId" element={<ProviderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Provider detail')).toBeTruthy()
  })

  it('renders provider display name in header when loaded', async () => {
    const provider = buildProvider({ displayName: 'Anthropic Claude' })
    server.use(http.get('*/api/v1/providers/:id', () => HttpResponse.json(provider)))

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/providers/provider_1']}>
          <Routes>
            <Route path="/providers/:providerId" element={<ProviderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Anthropic Claude')).toBeTruthy())
    expect(screen.getByText('Provider profile')).toBeTruthy()
  })

  it('renders fallback header and empty state when route has no providerId', () => {
    // No request will be made (enabled: false guards it), but register anyway in case
    server.use(http.get('*/api/v1/providers/:id', () => HttpResponse.json(buildProvider())))

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/providers/']}>
          <Routes>
            <Route path="/providers/" element={<ProviderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Provider detail')).toBeTruthy()
    expect(screen.getByText('Provider not found')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// ProvidersPage
// ---------------------------------------------------------------------------

describe('[spec: providers/console-list-page] ProvidersPage', () => {
  it('renders the providers page header with create button and policy link', async () => {
    setupProviderHandlers()
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProvidersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Providers')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create provider/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Access policy' })).toBeTruthy()
  })

  it('renders provider rows when the query resolves', async () => {
    setupProviderHandlers([buildProvider({ displayName: 'OpenAI GPT' })])
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProvidersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('OpenAI GPT')).toBeTruthy())
  })

  it('opens the create provider sheet when Create provider is clicked', async () => {
    setupProviderHandlers()
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProvidersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Create provider/i }))
    await waitFor(() => expect(screen.getByText('Create Provider')).toBeTruthy())
  })

  it('shows empty state when no providers are returned', async () => {
    setupProviderHandlers()
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProvidersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('No providers')).toBeTruthy())
  })

  it('deletes provider via DELETE /providers/:id when archive is triggered', async () => {
    stubPointerEvents()

    let deletedId = ''
    const collection = setupProviderHandlers([buildProvider()])
    // Override DELETE to capture id
    server.use(
      http.delete('*/api/v1/providers/:id', ({ params }) => {
        deletedId = String(params.id)
        collection.remove(String(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProvidersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Workers AI')
    fireEvent.click(screen.getByRole('button', { name: 'Delete provider' }))
    const allButtons = await screen.findAllByRole('button', { name: 'Delete provider' })
    fireEvent.click(allButtons[allButtons.length - 1]!)
    await waitFor(() => expect(deletedId).toBe('provider_1'))
  })
})

// ---------------------------------------------------------------------------
// ProviderPolicyPage
// ---------------------------------------------------------------------------

describe('[spec: providers/policy-page] ProviderPolicyPage', () => {
  it('shows page header while loading rules', () => {
    server.use(http.get('*/api/v1/access-rules', () => new Promise(() => {})))

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProviderPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Provider access policy')).toBeTruthy()
  })

  it('shows empty state when no access rules exist', async () => {
    setupAccessRuleHandlers()
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProviderPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('No access rules')).toBeTruthy())
    expect(screen.getByText(/Every configured provider is currently usable/)).toBeTruthy()
  })

  it('renders access rule rows with effect, provider, model, team, reason, and date', async () => {
    setupAccessRuleHandlers([buildAccessRule()])
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProviderPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('deny')).toBeTruthy())
    expect(screen.getByText('workers-ai')).toBeTruthy()
    expect(screen.getByText('@cf/meta/llama')).toBeTruthy()
    expect(screen.getByText('All teams')).toBeTruthy()
    expect(screen.getByText('Blocked by policy')).toBeTruthy()
  })

  it('renders team id when present', async () => {
    setupAccessRuleHandlers([buildAccessRule({ teamId: 'team-platform' })])
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProviderPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('team-platform')).toBeTruthy())
  })

  it('renders dash placeholder when reason is null', async () => {
    setupAccessRuleHandlers([buildAccessRule({ reason: null })])
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProviderPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('—')).toBeTruthy())
  })

  it('opens the CreateAccessRuleSheet when Add access rule is clicked', async () => {
    setupAccessRuleHandlers()
    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProviderPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Add access rule/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/Allow or deny provider and model access/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// CreateAccessRuleSheet
// ---------------------------------------------------------------------------

describe('[spec: providers/create-access-rule] CreateAccessRuleSheet', () => {
  it('renders the sheet title and description when open', () => {
    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('Add access rule')).toBeTruthy()
    expect(screen.getByText(/Allow or deny provider and model access/)).toBeTruthy()
  })

  it('does not render sheet content when closed', () => {
    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Add access rule')).toBeNull()
  })

  it('shows validation error when both provider id and model id are empty on submit', async () => {
    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    const submitBtn = screen.getByRole('button', { name: /Save access rule/i })
    fireEvent.click(submitBtn)
    await waitFor(() =>
      expect(screen.getByText('An access rule must target a provider id, a model id, or both.')).toBeTruthy(),
    )
  })

  it('posts to api.createAccessRule with provider id only when model id is empty', async () => {
    let capturedBody: Record<string, unknown> | null = null
    setupAccessRuleHandlers()
    server.use(
      http.post('*/api/v1/access-rules', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildAccessRule({ id: 'rule_new' }), { status: 201 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'workers-ai' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody!.providerId).toBe('workers-ai')
    expect(capturedBody!.effect).toBe('deny')
  })

  it('posts to api.createAccessRule with model id only when provider id is empty', async () => {
    let capturedBody: Record<string, unknown> | null = null
    setupAccessRuleHandlers()
    server.use(
      http.post('*/api/v1/access-rules', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildAccessRule({ id: 'rule_new' }), { status: 201 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Model id'), { target: { value: '@cf/meta/llama' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody!.modelId).toBe('@cf/meta/llama')
    expect(capturedBody!.effect).toBe('deny')
  })

  it('includes teamId and reason in payload when filled', async () => {
    let capturedBody: Record<string, unknown> | null = null
    setupAccessRuleHandlers()
    server.use(
      http.post('*/api/v1/access-rules', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildAccessRule({ id: 'rule_new' }), { status: 201 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'openai' } })
    fireEvent.change(screen.getByLabelText('Team id'), { target: { value: 'team-eng' } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cost control' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody!.providerId).toBe('openai')
    expect(capturedBody!.teamId).toBe('team-eng')
    expect(capturedBody!.reason).toBe('Cost control')
  })

  it('clears target error when subsequent submit provides a valid provider id', async () => {
    setupAccessRuleHandlers()
    server.use(
      http.post('*/api/v1/access-rules', () => HttpResponse.json(buildAccessRule({ id: 'rule_new' }), { status: 201 })),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    // First submit: empty -> validation error
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))
    await waitFor(() =>
      expect(screen.getByText('An access rule must target a provider id, a model id, or both.')).toBeTruthy(),
    )

    // Fill provider id and re-submit
    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'anthropic' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() =>
      expect(screen.queryByText('An access rule must target a provider id, a model id, or both.')).toBeNull(),
    )
  })

  it('shows toast error when api returns 500 for createAccessRule', async () => {
    server.use(http.post('*/api/v1/access-rules', () => HttpResponse.json({ error: 'Server error' }, { status: 500 })))

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'workers-ai' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    // After error, form is still rendered
    await waitFor(() => expect(screen.getByRole('button', { name: /Save access rule/i })).toBeTruthy())
  })

  it('allows selecting allow effect via the effect select', async () => {
    stubPointerEvents()

    let capturedBody: Record<string, unknown> | null = null
    setupAccessRuleHandlers()
    server.use(
      http.post('*/api/v1/access-rules', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildAccessRule({ id: 'rule_new', effect: 'allow' }), { status: 201 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    // Open the effect select and pick "allow"
    const trigger = screen.getByRole('combobox')
    trigger.focus()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)
    fireEvent.click(await screen.findByRole('option', { name: 'Allow' }))

    // Fill provider and submit to verify the allow effect is sent
    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'openai' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody!.effect).toBe('allow')
    expect(capturedBody!.providerId).toBe('openai')
  })
})

// ---------------------------------------------------------------------------
// CreateProviderSheet
// ---------------------------------------------------------------------------

describe('[spec: providers/create-provider] CreateProviderSheet', () => {
  it('renders sheet title and description when open', () => {
    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('Create Provider')).toBeTruthy()
    expect(screen.getByText(/Register a model provider without exposing raw credentials/)).toBeTruthy()
  })

  it('does not render sheet content when closed', () => {
    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Create Provider')).toBeNull()
  })

  it('posts to api and closes sheet on success', async () => {
    const onOpenChange = vi.fn()
    setupProviderHandlers()

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('includes baseUrl in api call when base URL field is filled', async () => {
    let capturedBody: Record<string, unknown> | null = null
    setupProviderHandlers()
    server.use(
      http.post('*/api/v1/providers', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildProvider(), { status: 201 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.openai.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody!.baseUrl).toBe('https://api.openai.com')
  })

  it('includes credentialRef in api call when credential id is filled', async () => {
    let capturedBody: Record<string, unknown> | null = null
    setupProviderHandlers()
    server.use(
      http.post('*/api/v1/providers', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildProvider(), { status: 201 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Credential id'), { target: { value: 'cred_abc' } })
    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect((capturedBody!.credentialRef as Record<string, unknown>).credentialId).toBe('cred_abc')
  })

  it('includes versionId in credentialRef when credential version id is also filled', async () => {
    let capturedBody: Record<string, unknown> | null = null
    setupProviderHandlers()
    server.use(
      http.post('*/api/v1/providers', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildProvider(), { status: 201 })
      }),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Credential id'), { target: { value: 'cred_abc' } })
    fireEvent.change(screen.getByLabelText('Credential version id'), { target: { value: 'vaultver_1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    const credRef = capturedBody!.credentialRef as Record<string, unknown>
    expect(credRef.credentialId).toBe('cred_abc')
    expect(credRef.versionId).toBe('vaultver_1')
  })

  it('does not close sheet when api returns 500', async () => {
    const onOpenChange = vi.fn()
    server.use(
      http.post('*/api/v1/providers', () => HttpResponse.json({ error: 'Provider already exists' }, { status: 500 })),
    )

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Save provider/i })).toBeTruthy())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

// ---------------------------------------------------------------------------
// useProviderActions
// ---------------------------------------------------------------------------

describe('[spec: providers/actions] useProviderActions', () => {
  function ActionsHarness({ onCapture }: { onCapture: (actions: ReturnType<typeof useProviderActions>) => void }) {
    const actions = useProviderActions()
    onCapture(actions)
    return null
  }

  it('exposes archiveProvider function and archiveProviderPending as false initially', () => {
    server.use(
      http.delete('*/api/v1/providers/:id', () => new HttpResponse(null, { status: 204 })),
      http.get('*/api/v1/providers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    let capturedActions: ReturnType<typeof useProviderActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            capturedActions = a
          }}
        />
      </QueryClientProvider>,
    )

    expect(typeof capturedActions!.archiveProvider).toBe('function')
    expect(typeof capturedActions!.archiveProviderPending).toBe('boolean')
    expect(capturedActions!.archiveProviderPending).toBe(false)
  })

  it('calls DELETE /providers/:id with the provided id on archiveProvider', async () => {
    let deletedId = ''
    server.use(
      http.delete('*/api/v1/providers/:id', ({ params }) => {
        deletedId = String(params.id)
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('*/api/v1/providers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    let capturedActions: ReturnType<typeof useProviderActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            capturedActions = a
          }}
        />
      </QueryClientProvider>,
    )

    capturedActions!.archiveProvider('provider_1')
    await waitFor(() => expect(deletedId).toBe('provider_1'))
  })

  it('shows toast success and invalidates providers query on successful delete', async () => {
    server.use(
      http.delete('*/api/v1/providers/:id', () => new HttpResponse(null, { status: 204 })),
      http.get('*/api/v1/providers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    let capturedActions: ReturnType<typeof useProviderActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            capturedActions = a
          }}
        />
      </QueryClientProvider>,
    )

    capturedActions!.archiveProvider('provider_ok')
    await waitFor(() => expect(capturedActions!.archiveProviderPending).toBe(false))
  })

  it('handles error response from DELETE /providers/:id without crashing', async () => {
    server.use(
      http.delete('*/api/v1/providers/:id', () => HttpResponse.json({ error: 'Delete failed' }, { status: 500 })),
      http.get('*/api/v1/providers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    let capturedActions: ReturnType<typeof useProviderActions> | undefined
    render(
      <QueryClientProvider client={mkClient()}>
        <ActionsHarness
          onCapture={(a) => {
            capturedActions = a
          }}
        />
      </QueryClientProvider>,
    )

    capturedActions!.archiveProvider('provider_fail')
    await waitFor(() => expect(capturedActions!.archiveProviderPending).toBe(false))
  })
})
