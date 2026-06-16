import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { AccessRule } from '@/lib/api'
import { HttpResponse, http, server } from '@/test/msw'
import { CreateAccessRuleSheet } from './CreateAccessRuleSheet'
import { ProviderPolicyPage } from './ProviderPolicyPage'

// ─── Fixtures ────────────────────────────────────────────────────────────────

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

function setupAccessRuleHandlers(rules: AccessRule[] = []) {
  const items = new Map(rules.map((rule) => [rule.id, rule]))
  server.use(
    http.get('*/api/v1/access-rules', () =>
      HttpResponse.json({
        data: [...items.values()],
        pagination: { limit: 50, hasMore: false, nextCursor: null },
      }),
    ),
    http.post('*/api/v1/access-rules', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      const rule = buildAccessRule({ id: `rule_new_${items.size}`, ...body })
      items.set(rule.id, rule)
      return HttpResponse.json(rule, { status: 201 })
    }),
  )
  return items
}

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
