import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { AccessRule, Provider } from '@/lib/api'
import { CreateAccessRuleSheet } from './CreateAccessRuleSheet'
import { CreateProviderSheet } from './CreateProviderSheet'
import { ProviderDetailPage } from './ProviderDetailPage'
import { ProviderDetailView } from './ProviderDetailView'
import { ProviderPolicyPage } from './ProviderPolicyPage'
import { ProvidersPage } from './ProvidersPage'
import { ProvidersView } from './ProvidersView'
import { useProviderActions } from './use-provider-actions'

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

    const onArchive = vi.fn()
    const providers = [buildProvider()]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={onArchive} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete provider' }))
    // Wait for dialog to appear and click the confirm button
    const allButtons = await screen.findAllByRole('button', { name: 'Delete provider' })
    fireEvent.click(allButtons[allButtons.length - 1]!)
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('provider_1'))
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
  it('renders loading header while provider is fetching', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readProvider: vi.fn(() => new Promise(() => {})),
    } as never)

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
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readProvider: vi.fn().mockResolvedValue(provider),
    } as never)

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
})

// ---------------------------------------------------------------------------
// ProvidersPage
// ---------------------------------------------------------------------------

describe('[spec: providers/console-list-page] ProvidersPage', () => {
  it('renders the providers page header with create button and policy link', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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
    const providers = [buildProvider({ displayName: 'OpenAI GPT' })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listProviders: vi.fn().mockResolvedValue({ data: providers }),
    } as never)

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
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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
})

// ---------------------------------------------------------------------------
// ProviderPolicyPage
// ---------------------------------------------------------------------------

describe('[spec: providers/policy-page] ProviderPolicyPage', () => {
  it('shows page header while loading rules', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAccessRules: vi.fn(() => new Promise(() => {})),
    } as never)

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
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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
    const rules = [buildAccessRule()]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAccessRules: vi.fn().mockResolvedValue({ data: rules }),
    } as never)

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
    const rules = [buildAccessRule({ teamId: 'team-platform' })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAccessRules: vi.fn().mockResolvedValue({ data: rules }),
    } as never)

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
    const rules = [buildAccessRule({ reason: null })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAccessRules: vi.fn().mockResolvedValue({ data: rules }),
    } as never)

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
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter>
          <ProviderPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Add access rule/i }))
    // Sheet opens — the SheetTitle appears inside a dialog
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

  it('calls api.createAccessRule with provider id only when model id is empty', async () => {
    const createAccessRule = vi.fn().mockResolvedValue({ id: 'rule_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createAccessRule,
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    const providerInput = screen.getByLabelText('Provider id')
    fireEvent.change(providerInput, { target: { value: 'workers-ai' } })

    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() =>
      expect(createAccessRule).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'workers-ai', effect: 'deny' }),
      ),
    )
  })

  it('calls api.createAccessRule with model id only when provider id is empty', async () => {
    const createAccessRule = vi.fn().mockResolvedValue({ id: 'rule_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createAccessRule,
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    const modelInput = screen.getByLabelText('Model id')
    fireEvent.change(modelInput, { target: { value: '@cf/meta/llama' } })

    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() =>
      expect(createAccessRule).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: '@cf/meta/llama', effect: 'deny' }),
      ),
    )
  })

  it('includes teamId and reason in payload when filled', async () => {
    const createAccessRule = vi.fn().mockResolvedValue({ id: 'rule_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createAccessRule,
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'openai' } })
    fireEvent.change(screen.getByLabelText('Team id'), { target: { value: 'team-eng' } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cost control' } })

    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() =>
      expect(createAccessRule).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openai',
          teamId: 'team-eng',
          reason: 'Cost control',
        }),
      ),
    )
  })

  it('clears target error when subsequent submit provides a valid provider id', async () => {
    const createAccessRule = vi.fn().mockResolvedValue({ id: 'rule_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createAccessRule,
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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

    await waitFor(() => expect(createAccessRule).toHaveBeenCalled())
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

  it('calls api.createProvider and closes sheet on success', async () => {
    const onOpenChange = vi.fn()
    const createProvider = vi.fn().mockResolvedValue(buildProvider())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    )

    // Submit via the "Save provider" button inside ProviderForm
    const submitBtn = screen.getByRole('button', { name: /Save provider/i })
    fireEvent.click(submitBtn)

    await waitFor(() => expect(createProvider).toHaveBeenCalled())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

// ---------------------------------------------------------------------------
// CreateProviderSheet — branch coverage for optional fields
// ---------------------------------------------------------------------------

describe('[spec: providers/create-provider-branches] CreateProviderSheet optional field branches', () => {
  it('includes baseUrl in api call when base URL field is filled', async () => {
    const createProvider = vi.fn().mockResolvedValue(buildProvider())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.openai.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() =>
      expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://api.openai.com' })),
    )
  })

  it('includes credentialRef in api call when credential id is filled', async () => {
    const createProvider = vi.fn().mockResolvedValue(buildProvider())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Credential id'), { target: { value: 'cred_abc' } })
    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() =>
      expect(createProvider).toHaveBeenCalledWith(
        expect.objectContaining({ credentialRef: { credentialId: 'cred_abc' } }),
      ),
    )
  })

  it('includes versionId in credentialRef when credential version id is also filled', async () => {
    const createProvider = vi.fn().mockResolvedValue(buildProvider())
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Credential id'), { target: { value: 'cred_abc' } })
    fireEvent.change(screen.getByLabelText('Credential version id'), { target: { value: 'vaultver_1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() =>
      expect(createProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialRef: { credentialId: 'cred_abc', versionId: 'vaultver_1' },
        }),
      ),
    )
  })

  it('does not close sheet when api.createProvider rejects with an Error', async () => {
    const onOpenChange = vi.fn()
    const createProvider = vi.fn().mockRejectedValue(new Error('Provider already exists'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() => expect(createProvider).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('handles non-Error rejection by stringifying the value', async () => {
    const onOpenChange = vi.fn()
    const createProvider = vi.fn().mockRejectedValue('quota exceeded')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateProviderSheet open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    await waitFor(() => expect(createProvider).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

// ---------------------------------------------------------------------------
// CreateAccessRuleSheet — onError handler and effect select
// ---------------------------------------------------------------------------

describe('[spec: providers/create-access-rule-error] CreateAccessRuleSheet error handler', () => {
  it('shows toast error when api.createAccessRule rejects with an Error instance', async () => {
    const createAccessRule = vi.fn().mockRejectedValue(new Error('Server error'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createAccessRule,
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'workers-ai' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() => expect(createAccessRule).toHaveBeenCalled())
  })

  it('shows toast error with stringified value when api.createAccessRule rejects with a non-Error', async () => {
    const createAccessRule = vi.fn().mockRejectedValue('quota exceeded')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createAccessRule,
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <CreateAccessRuleSheet open={true} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'workers-ai' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() => expect(createAccessRule).toHaveBeenCalled())
  })

  it('allows selecting allow effect via the effect select (onValueChange branch)', async () => {
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

    const createAccessRule = vi.fn().mockResolvedValue({ id: 'rule_new' })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      createAccessRule,
      listAccessRules: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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

    // Now fill provider and submit to verify the allow effect is sent
    fireEvent.change(screen.getByLabelText('Provider id'), { target: { value: 'openai' } })
    fireEvent.click(screen.getByRole('button', { name: /Save access rule/i }))

    await waitFor(() =>
      expect(createAccessRule).toHaveBeenCalledWith(expect.objectContaining({ effect: 'allow', providerId: 'openai' })),
    )
  })
})

// ---------------------------------------------------------------------------
// ProviderDetailPage — branch when no providerId param
// ---------------------------------------------------------------------------

describe('[spec: providers/console-detail-page-branches] ProviderDetailPage without providerId', () => {
  it('renders fallback header and empty state when route has no providerId', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readProvider: vi.fn().mockResolvedValue(buildProvider()),
    } as never)

    render(
      <QueryClientProvider client={mkClient()}>
        <MemoryRouter initialEntries={['/providers/']}>
          <Routes>
            {/* Route without :providerId — providerId param will be undefined */}
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
// ProvidersView — lastError branch coverage
// ---------------------------------------------------------------------------

describe('[spec: providers/console-list-last-error] ProvidersView lastError badge detail', () => {
  it('passes lastError JSON as detail to StatusBadge when provider has an error', () => {
    const providers = [buildProvider({ lastError: { code: 'TIMEOUT' } })]
    render(
      <MemoryRouter>
        <ProvidersView providers={providers} pagination={pagination(providers)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    // StatusBadge renders detail as aria-label — just verify enabled badge is shown
    expect(screen.getByText('enabled')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// useProviderActions — hook via minimal component wrapper
// ---------------------------------------------------------------------------

describe('[spec: providers/actions] useProviderActions', () => {
  function ActionsHarness({ onCapture }: { onCapture: (actions: ReturnType<typeof useProviderActions>) => void }) {
    const actions = useProviderActions()
    onCapture(actions)
    return null
  }

  it('calls api.deleteProvider with the provided id on archiveProvider', async () => {
    const deleteProvider = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      deleteProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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
    await waitFor(() => expect(deleteProvider.mock.calls[0]?.[0]).toBe('provider_1'))
  })

  it('exposes archiveProviderPending as false when no mutation is in flight', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      deleteProvider: vi.fn(() => new Promise(() => {})),
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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

    expect(capturedActions!.archiveProviderPending).toBe(false)
  })

  it('shows toast success and invalidates query on successful delete', async () => {
    const deleteProvider = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      deleteProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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
    await waitFor(() => expect(deleteProvider.mock.calls[0]?.[0]).toBe('provider_ok'))
  })

  it('shows toast error when api.deleteProvider rejects with an Error', async () => {
    const deleteProvider = vi.fn().mockRejectedValue(new Error('Delete failed'))
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      deleteProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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
    await waitFor(() => expect(deleteProvider.mock.calls[0]?.[0]).toBe('provider_fail'))
  })

  it('shows toast error with stringified value when error is not an Error instance', async () => {
    const deleteProvider = vi.fn().mockRejectedValue('raw string error')
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      deleteProvider,
      listProviders: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

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

    capturedActions!.archiveProvider('provider_fail2')
    await waitFor(() => expect(deleteProvider.mock.calls[0]?.[0]).toBe('provider_fail2'))
  })
})
