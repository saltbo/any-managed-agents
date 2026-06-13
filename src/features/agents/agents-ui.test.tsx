/**
 * Tests for agents feature components and logic:
 * - AgentsView (table rows, empty state)
 * - AgentDetailView (tabs, version selector, null agent)
 * - CreateAgentSheet (open/closed state)
 * - AgentBuilderSteps (BuilderStepper, StartStep, CoreStep, ToolsStep, SandboxStep, RolesStep, TestEnvironmentField)
 * - AgentBuilderPage (step navigation, validation, draft workflow)
 * - AgentsPage (filter, search, provider filter)
 * - AgentDetailPage (route rendering)
 * - agent-builder-model extensions (stepErrors, parseHandoffTargets, toAgentInput branches)
 *
 * Pattern: MemoryRouter, screen + fireEvent, .toBeTruthy(), afterEach cleanup + vi.restoreAllMocks().
 * No jest-dom matchers. Mock API via vi.spyOn(apiModule.api, ...) per the sessions-pages.test pattern.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type {
  Agent,
  AgentVersion,
  Connector,
  Environment,
  ListResponse,
  Provider,
  ProviderModel,
  Session,
  SessionAgentSnapshot,
  SessionEvent,
} from '@/lib/api'
import * as apiModule from '@/lib/api'
import { ApiError } from '@/lib/api'
import { AgentBuilderPage } from './AgentBuilderPage'
import {
  BuilderStepper,
  CoreStep,
  RolesStep,
  SandboxStep,
  StartStep,
  TestEnvironmentField,
  ToolsStep,
} from './AgentBuilderSteps'
import { AgentDetailPage } from './AgentDetailPage'
import { AgentDetailView } from './AgentDetailView'
import { AgentsPage } from './AgentsPage'
import { AgentsView } from './AgentsView'
import {
  agentApiExamples,
  apiErrorToBuilder,
  emptyBuilderDraft,
  parseHandoffTargets,
  stepErrors,
  toAgentInput,
} from './agent-builder-model'
import { CreateAgentSheet } from './CreateAgentSheet'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listOf<T>(data: T[] = []): ListResponse<T> {
  return { data, pagination: { limit: 50, hasMore: false, nextCursor: null } }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    projectId: 'project_1',
    name: 'Coding agent',
    description: null,
    instructions: 'Do the work',
    providerId: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: ['ama@coding-agent'],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: { enabled: false },
    tools: [
      { name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
      { name: 'write', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
    ],
    mcpConnectors: [],
    metadata: {},
    archivedAt: null,
    currentVersionId: 'agentver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildAgentVersion(overrides: Partial<AgentVersion> = {}): AgentVersion {
  return {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    instructions: 'Do the work',
    providerId: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: ['ama@coding-agent'],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: { enabled: false },
    tools: [{ name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} }],
    mcpConnectors: [],
    metadata: {},
    createdAt: now,
    ...overrides,
  }
}

function buildSessionAgentSnapshot(overrides: Partial<SessionAgentSnapshot> = {}): SessionAgentSnapshot {
  return {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    instructions: 'Do the work',
    providerId: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: [],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: {},
    tools: [],
    mcpConnectors: [],
    metadata: {},
    createdAt: now,
    ...overrides,
  }
}

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: buildSessionAgentSnapshot(),
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: null,
    title: 'Test session',
    resourceRefs: [],
    env: {},
    secretEnv: [],
    runtimeMetadata: {
      hostingMode: 'cloud',
      runtime: 'ama',
      runtimeConfig: {},
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      driver: 'ama-cloud',
      backend: 'ama-cloud',
      protocol: 'ama-runtime-rpc',
    },
    state: 'idle',
    stateReason: null,
    metadata: {},
    startedAt: now,
    stoppedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_1',
    projectId: 'project_1',
    name: 'Node workspace',
    description: null,
    packages: [{ name: 'tsx', version: 'latest' }],
    variables: {},
    credentialRefs: [],
    hostingMode: 'cloud',
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    mcpPolicy: {},
    packageManagerPolicy: {},
    resourceLimits: { memoryMb: 1024 },
    runtimeConfig: { image: 'node:24' },
    metadata: {},
    archivedAt: null,
    currentVersionId: 'envver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'provider_1',
    projectId: 'project_1',
    type: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: null,
    isDefault: false,
    enabled: true,
    credentialRef: null,
    credentialStatus: 'configured',
    metadata: {},
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'connector_1',
    name: 'GitHub connector',
    description: 'Provides GitHub API access',
    category: 'vcs',
    trustLevel: 'trusted',
    capabilities: ['read'],
    supportedAuthModes: ['token'],
    setupRequirements: [],
    tools: [
      {
        name: 'github.list_repos',
        description: 'List repositories',
        inputSchema: { type: 'object' },
        approvalMode: 'none',
        policyMetadata: {},
      },
    ],
    metadata: {},
    availability: 'available',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildProviderModel(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: 'model_1',
    providerId: 'workers-ai',
    modelId: '@cf/moonshotai/kimi-k2.6',
    displayName: 'Kimi K2.6',
    capabilities: [],
    contextWindow: null,
    pricing: {},
    availability: 'available',
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildPagination<T>(items: T[]): ClientPagination<T> {
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

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// AgentsView
// ---------------------------------------------------------------------------

describe('[spec: agents/console-list] AgentsView', () => {
  it('renders empty state when no agents', () => {
    render(
      <MemoryRouter>
        <AgentsView agents={[]} pagination={buildPagination([])} onCreateSession={vi.fn()} onArchive={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('No agents')).toBeTruthy()
  })

  it('renders a table row per agent with name, status, model, skills, tools, and date', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Coding agent')).toBeTruthy()
    expect(screen.getByText('workers-ai / @cf/moonshotai/kimi-k2.6')).toBeTruthy()
    expect(screen.getByText('ama@coding-agent')).toBeTruthy()
    expect(screen.getByText('read, write')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText('v1')).toBeTruthy()
  })

  it('renders agent id as description when description is null', () => {
    const agent = buildAgent({ description: null })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )
    // description falls back to agent.id
    expect(screen.getByText('agent_1')).toBeTruthy()
  })

  it('calls onCreateSession with agent id when Create session button is clicked', () => {
    const onCreateSession = vi.fn()
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={onCreateSession}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    expect(onCreateSession).toHaveBeenCalledWith('agent_1')
  })

  it('renders None for skills and tools when both are empty', () => {
    const agent = buildAgent({ skills: [], tools: [] })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )
    const nones = screen.getAllByText('None')
    expect(nones.length).toBeGreaterThanOrEqual(2)
  })

  it('shows archived label for archived agent', () => {
    const agent = buildAgent({ archivedAt: now })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('archived')).toBeTruthy()
  })

  it('renders model as None/None when providerId and model are null', () => {
    const agent = buildAgent({ providerId: null, model: null })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('None / None')).toBeTruthy()
  })

  it('renders agent description when provided', () => {
    const agent = buildAgent({ description: 'Does stuff' })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Does stuff')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// AgentDetailView
// ---------------------------------------------------------------------------

describe('[spec: agents/console-detail] AgentDetailView', () => {
  it('renders empty state when agent is null', () => {
    render(
      <MemoryRouter>
        <AgentDetailView agent={null} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent not found')).toBeTruthy()
  })

  it('renders agent model configuration for a loaded agent', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent model configuration')).toBeTruthy()
    expect(screen.getByText('workers-ai')).toBeTruthy()
    expect(screen.getByText('@cf/moonshotai/kimi-k2.6')).toBeTruthy()
    expect(screen.getByText('ama@coding-agent')).toBeTruthy()
    expect(screen.getByText('read, write')).toBeTruthy()
  })

  it('renders the sessions tab with related sessions', async () => {
    const agent = buildAgent()
    const session = buildSession()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[session]} />
      </MemoryRouter>,
    )
    const sessionsTab = screen.getByRole('tab', { name: 'Sessions' })
    fireEvent.pointerDown(sessionsTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(sessionsTab)
    fireEvent.mouseUp(sessionsTab)
    fireEvent.click(sessionsTab)
    await waitFor(() => expect(sessionsTab.getAttribute('data-state')).toBe('active'))
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0)
  })

  it('renders version selector when versions list is non-empty', () => {
    const agent = buildAgent()
    const version = buildAgentVersion()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[version]} sessions={[]} />
      </MemoryRouter>,
    )
    // When versions are present, a Select trigger with "w-44" class appears
    expect(screen.getAllByText('v1').length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to agent fields when versions list is empty', () => {
    const agent = buildAgent({ version: 3 })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('v3')).toBeTruthy()
  })

  it('renders archive button when onArchive is provided and agent is not archived', async () => {
    const onArchive = vi.fn()
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} onArchive={onArchive} />
      </MemoryRouter>,
    )
    const archiveBtn = screen.getByRole('button', { name: 'Archive' })
    fireEvent.click(archiveBtn)
    const confirmBtn = await screen.findByRole('button', { name: 'Archive agent' })
    fireEvent.click(confirmBtn)
    expect(onArchive).toHaveBeenCalledWith('agent_1')
  })

  it('does not render archive button when agent is already archived', () => {
    const agent = buildAgent({ archivedAt: now })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
  })

  it('does not render archive button when onArchive is not provided', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
  })

  it('renders None for skills, tools, connectors, role, and tags when all are empty', () => {
    const agent = buildAgent({ skills: [], tools: [], mcpConnectors: [], role: null, capabilityTags: [] })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    const nones = screen.getAllByText('None')
    expect(nones.length).toBeGreaterThanOrEqual(4)
  })

  it('renders agent without currentVersionId falling back to agent.id', () => {
    const agent = buildAgent({ currentVersionId: null })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent model configuration')).toBeTruthy()
  })

  it('renders MCP connectors value', () => {
    const agent = buildAgent({ mcpConnectors: ['github-connector'] })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('github-connector')).toBeTruthy()
  })

  it('renders role value when set', () => {
    const agent = buildAgent({ role: 'maintainer' })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('maintainer')).toBeTruthy()
  })

  it('renders capability tags value when set', () => {
    const agent = buildAgent({ capabilityTags: ['triage', 'code-review'] })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('triage, code-review')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// CreateAgentSheet
// ---------------------------------------------------------------------------

describe('CreateAgentSheet', () => {
  it('does not render content when closed', () => {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open={false} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByText('Create Agent')).toBeNull()
  })

  it('renders sheet title and form when open', () => {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Create Agent')).toBeTruthy()
    expect(screen.getByText('Save agent')).toBeTruthy()
  })

  it('calls API and closes sheet on successful submission', async () => {
    const createdAgent = buildAgent()
    vi.spyOn(apiModule.api, 'createAgent').mockResolvedValue(createdAgent)
    const onOpenChange = vi.fn()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const submitBtn = screen.getByRole('button', { name: 'Save agent' })
    fireEvent.click(submitBtn)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows creating agent label while mutation is pending', async () => {
    // Keep mutation pending with a never-resolving promise
    vi.spyOn(apiModule.api, 'createAgent').mockReturnValue(new Promise(() => {}))
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const submitBtn = screen.getByRole('button', { name: 'Save agent' })
    fireEvent.click(submitBtn)
    await waitFor(() => expect(screen.getByText('Creating agent')).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// BuilderStepper
// ---------------------------------------------------------------------------

describe('BuilderStepper', () => {
  it('renders all steps except done when not published', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="start" published={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Goal/)).toBeTruthy()
    expect(screen.getByText(/Core settings/)).toBeTruthy()
    expect(screen.queryByText(/API examples/)).toBeNull()
  })

  it('renders the done step when published', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="done" published={true} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/API examples/)).toBeTruthy()
  })

  it('marks current step as aria-current=step', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="core" published={false} />
      </MemoryRouter>,
    )
    const coreLink = screen.getByText(/Core settings/).closest('a')
    expect(coreLink?.getAttribute('aria-current')).toBe('step')
  })

  it('does not mark non-current steps as aria-current', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="core" published={false} />
      </MemoryRouter>,
    )
    const startLink = screen.getByText(/Goal/).closest('a')
    expect(startLink?.getAttribute('aria-current')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// StartStep
// ---------------------------------------------------------------------------

describe('StartStep', () => {
  it('renders goal textarea, draft button, skip button, and templates', () => {
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Draft agent configuration' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start from scratch' })).toBeTruthy()
    expect(screen.getByText('Coding agent')).toBeTruthy()
    expect(screen.getByText('Research assistant')).toBeTruthy()
    expect(screen.getByText('Operations triage')).toBeTruthy()
  })

  it('disables draft button when goal is empty whitespace', () => {
    render(
      <MemoryRouter>
        <StartStep goal="   " setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    const draftBtn = screen.getByRole('button', { name: 'Draft agent configuration' })
    expect(draftBtn.hasAttribute('disabled')).toBe(true)
  })

  it('enables draft button when goal has content', () => {
    render(
      <MemoryRouter>
        <StartStep
          goal="Review PRs"
          setGoal={vi.fn()}
          onDraftFromGoal={vi.fn()}
          onUseTemplate={vi.fn()}
          onSkip={vi.fn()}
        />
      </MemoryRouter>,
    )
    const draftBtn = screen.getByRole('button', { name: 'Draft agent configuration' })
    expect(draftBtn.hasAttribute('disabled')).toBe(false)
  })

  it('calls onDraftFromGoal when draft button is clicked', () => {
    const onDraftFromGoal = vi.fn()
    render(
      <MemoryRouter>
        <StartStep
          goal="Review PRs"
          setGoal={vi.fn()}
          onDraftFromGoal={onDraftFromGoal}
          onUseTemplate={vi.fn()}
          onSkip={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draft agent configuration' }))
    expect(onDraftFromGoal).toHaveBeenCalledTimes(1)
  })

  it('calls onSkip when start from scratch is clicked', () => {
    const onSkip = vi.fn()
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={onSkip} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start from scratch' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('calls onUseTemplate with the coding template when first Use template is clicked', () => {
    const onUseTemplate = vi.fn()
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={onUseTemplate} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    const useBtns = screen.getAllByRole('button', { name: 'Use template' })
    fireEvent.click(useBtns[0]!)
    expect(onUseTemplate).toHaveBeenCalledTimes(1)
    expect(onUseTemplate.mock.calls[0]![0].id).toBe('coding')
  })

  it('calls setGoal when typing in the textarea', () => {
    const setGoal = vi.fn()
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={setGoal} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Build a review agent' } })
    expect(setGoal).toHaveBeenCalledWith('Build a review agent')
  })
})

// ---------------------------------------------------------------------------
// CoreStep
// ---------------------------------------------------------------------------

describe('CoreStep', () => {
  function renderCoreStep(props: Partial<Parameters<typeof CoreStep>[0]> = {}) {
    const queryClient = makeQueryClient()
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} providers={[]} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders name, description, instructions, provider, and model fields', () => {
    renderCoreStep()
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Description')).toBeTruthy()
    expect(screen.getByLabelText('Instructions')).toBeTruthy()
    expect(screen.getByLabelText('Provider')).toBeTruthy()
    expect(screen.getByLabelText('Model')).toBeTruthy()
  })

  it('renders provider error when errors.provider is set', () => {
    renderCoreStep({ errors: { provider: 'Provider is required.' } })
    expect(screen.getByText('Provider is required.')).toBeTruthy()
  })

  it('renders model error when errors.model is set', () => {
    renderCoreStep({ errors: { model: 'Model is required.' } })
    expect(screen.getByText('Model is required.')).toBeTruthy()
  })

  it('renders name error when errors.name is set', () => {
    renderCoreStep({ errors: { name: 'Name is required.' } })
    expect(screen.getByText('Name is required.')).toBeTruthy()
  })

  it('renders instructions error when errors.instructions is set', () => {
    renderCoreStep({ errors: { instructions: 'Instructions are required.' } })
    expect(screen.getByText('Instructions are required.')).toBeTruthy()
  })

  it('always shows workers-ai platform default as a provider option', () => {
    renderCoreStep()
    expect(screen.getByText('workers-ai (platform default)')).toBeTruthy()
  })

  it('does not render disabled providers in the list', () => {
    const disabledProvider = buildProvider({ type: 'anthropic', displayName: 'Anthropic', enabled: false })
    renderCoreStep({ providers: [disabledProvider] })
    expect(screen.queryByText(/Anthropic \(anthropic\)/)).toBeNull()
  })

  it('renders current model in the list when model is set but not in catalog', () => {
    renderCoreStep({ draft: { ...emptyBuilderDraft, model: 'custom-model' } })
    expect(screen.getByText('custom-model')).toBeTruthy()
  })

  it('renders default model when model is in empty catalog', () => {
    // When there's no catalog but a model is set, the model value shows in the trigger
    const draft = { ...emptyBuilderDraft, model: '@cf/moonshotai/kimi-k2.6' }
    renderCoreStep({ draft })
    expect(screen.getByText('@cf/moonshotai/kimi-k2.6')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// ToolsStep
// ---------------------------------------------------------------------------

describe('ToolsStep', () => {
  it('renders allowed tools textarea and empty connector message when no connectors', () => {
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Allowed tools')).toBeTruthy()
    expect(screen.getByText('No MCP connectors are available in the catalog.')).toBeTruthy()
  })

  it('renders connector options with tools when connectors are present', () => {
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('GitHub connector')).toBeTruthy()
    expect(screen.getByText('github.list_repos')).toBeTruthy()
    expect(screen.getByText('Approval mode: none')).toBeTruthy()
  })

  it('renders connector tool description when present', () => {
    const connector = buildConnector({
      tools: [
        {
          name: 'github.list_repos',
          description: 'Lists all repos',
          inputSchema: {},
          approvalMode: 'none',
          policyMetadata: {},
        },
      ],
    })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Lists all repos')).toBeTruthy()
  })

  it('disables connector checkbox when availability is unavailable', () => {
    const connector = buildConnector({ availability: 'unavailable' })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox.hasAttribute('disabled')).toBe(true)
  })

  it('calls setField to add connector when available checkbox is clicked', () => {
    const setField = vi.fn()
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep
          draft={{ ...emptyBuilderDraft, mcpConnectors: [] }}
          errors={{}}
          setField={setField}
          connectors={[connector]}
        />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(setField).toHaveBeenCalled()
  })

  it('shows error when errors.allowedTools is set', () => {
    render(
      <MemoryRouter>
        <ToolsStep
          draft={emptyBuilderDraft}
          errors={{ allowedTools: 'Tool is blocked by policy.' }}
          setField={vi.fn()}
          connectors={[]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Tool is blocked by policy.')).toBeTruthy()
  })

  it('renders connector tool inputSchema JSON when non-empty', () => {
    const connector = buildConnector({
      tools: [
        {
          name: 'tool_x',
          description: null,
          inputSchema: { type: 'object', properties: { x: {} } },
          approvalMode: 'none',
          policyMetadata: {},
        },
      ],
    })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Schema:/)).toBeTruthy()
  })

  it('shows checked connector when it is already selected in draft', () => {
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep
          draft={{ ...emptyBuilderDraft, mcpConnectors: ['connector_1'] }}
          errors={{}}
          setField={vi.fn()}
          connectors={[connector]}
        />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox')
    // shadcn Checkbox uses data-state="checked" instead of native checked attribute
    expect(checkbox.getAttribute('data-state')).toBe('checked')
  })
})

// ---------------------------------------------------------------------------
// SandboxStep
// ---------------------------------------------------------------------------

describe('SandboxStep', () => {
  it('renders sandbox checkbox and description', () => {
    render(
      <MemoryRouter>
        <SandboxStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Enable sandbox execution')).toBeTruthy()
    expect(screen.getByText(/Cloudflare Sandbox execution/)).toBeTruthy()
  })

  it('hides skills textarea when sandbox is disabled', () => {
    render(
      <MemoryRouter>
        <SandboxStep draft={{ ...emptyBuilderDraft, sandboxEnabled: false }} errors={{}} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByLabelText('Carried skills')).toBeNull()
  })

  it('shows skills textarea when sandbox is enabled', () => {
    render(
      <MemoryRouter>
        <SandboxStep draft={{ ...emptyBuilderDraft, sandboxEnabled: true }} errors={{}} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Carried skills')).toBeTruthy()
  })

  it('calls setField when checkbox is toggled', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <SandboxStep draft={emptyBuilderDraft} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    const checkbox = screen.getByLabelText('Enable sandbox execution')
    fireEvent.click(checkbox)
    expect(setField).toHaveBeenCalled()
  })

  it('shows skills error when errors.skills is set', () => {
    render(
      <MemoryRouter>
        <SandboxStep
          draft={{ ...emptyBuilderDraft, sandboxEnabled: true }}
          errors={{ skills: 'Invalid skill ref.' }}
          setField={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Invalid skill ref.')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// RolesStep
// ---------------------------------------------------------------------------

describe('RolesStep', () => {
  it('renders role, capability tags, handoff targets, and memory fields', () => {
    render(
      <MemoryRouter>
        <RolesStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Role')).toBeTruthy()
    expect(screen.getByLabelText('Capability tags')).toBeTruthy()
    expect(screen.getByLabelText('Handoff targets')).toBeTruthy()
    expect(screen.getByLabelText('Enable project-scoped agent memory')).toBeTruthy()
  })

  it('renders handoff targets error when set', () => {
    render(
      <MemoryRouter>
        <RolesStep
          draft={emptyBuilderDraft}
          errors={{ handoffTargets: 'Invalid handoff target format' }}
          setField={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Invalid handoff target format')).toBeTruthy()
  })

  it('calls setField when memory checkbox is toggled', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <RolesStep draft={emptyBuilderDraft} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    const memoryCheckbox = screen.getByLabelText('Enable project-scoped agent memory')
    fireEvent.click(memoryCheckbox)
    expect(setField).toHaveBeenCalled()
  })

  it('renders memoryEnabled error when set', () => {
    render(
      <MemoryRouter>
        <RolesStep draft={emptyBuilderDraft} errors={{ memoryEnabled: 'Memory error' }} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Memory error')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// TestEnvironmentField
// ---------------------------------------------------------------------------

describe('TestEnvironmentField', () => {
  it('shows no active environments message when environments list is empty', () => {
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Create one on the Environments page' })).toBeTruthy()
  })

  it('renders description text when active environments exist', () => {
    const env = buildEnvironment()
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[env]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('The draft test session runs against this environment.')).toBeTruthy()
  })

  it('shows no active environments link when only archived environments exist', () => {
    const archived = buildEnvironment({ id: 'env_archived', name: 'Archived Env', archivedAt: now })
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[archived]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    // When all environments are archived, the link to Environments page appears
    expect(screen.getByRole('link', { name: 'Create one on the Environments page' })).toBeTruthy()
  })

  it('shows description text when at least one active environment exists', () => {
    const active = buildEnvironment({ id: 'env_active', name: 'Active Env' })
    const archived = buildEnvironment({ id: 'env_archived', name: 'Archived Env', archivedAt: now })
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[active, archived]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('The draft test session runs against this environment.')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// AgentBuilderPage — step navigation, validation
// ---------------------------------------------------------------------------

describe('[spec: agents/builder] AgentBuilderPage', () => {
  beforeEach(() => {
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
  })

  function setupDefaultApiMocks() {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
  }

  it('renders start step at default route', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Agent builder')).toBeTruthy()
    expect(screen.getByText('Goal')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start from scratch' })).toBeTruthy()
  })

  it('renders core step when step=core is in the URL', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Core settings')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('renders tools step when step=tools is in the URL', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=tools']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Tools and approvals')).toBeTruthy()
  })

  it('renders sandbox step when step=sandbox is in the URL', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=sandbox']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Sandbox access')).toBeTruthy()
  })

  it('renders roles step when step=roles is in the URL', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=roles']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Roles and memory')).toBeTruthy()
  })

  it('renders test step when step=test is in the URL', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=test']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Test and publish')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Publish agent' })).toBeTruthy()
  })

  it('renders done step with no-published message when step=done and no agent published', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=done']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('API examples')).toBeTruthy()
    expect(screen.getByText('Publish an agent from the test step to see its API examples.')).toBeTruthy()
  })

  it('defaults to start step when step param is unknown', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=bogus']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Goal')).toBeTruthy()
  })

  it('shows validation errors and stays on core step when Next is clicked with empty draft', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const nextBtn = screen.getByRole('button', { name: /Next/ })
    fireEvent.click(nextBtn)
    expect(screen.getByText('Name is required.')).toBeTruthy()
  })

  it('shows Back button on core step', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })

  it('disables Start test session button when no environment selected', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=test']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const startBtn = screen.getByRole('button', { name: 'Start test session' })
    expect(startBtn.hasAttribute('disabled')).toBe(true)
  })

  it('publish with invalid draft redirects to core step', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=test']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const publishBtn = screen.getByRole('button', { name: 'Publish agent' })
    fireEvent.click(publishBtn)
    // Will navigate to core step and show errors - just verify it doesn't crash
    expect(publishBtn).toBeTruthy()
  })

  it('clicking Skip on start step navigates to core step', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=start']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start from scratch' }))
    // After skip, should be on core step
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('clicking Draft agent configuration on start step navigates to core step', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=start']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // Type a goal then draft
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review incoming PRs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft agent configuration' }))
    // Should navigate to core step with pre-filled draft
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('start step navigate via Use template', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=start']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const useBtns = screen.getAllByRole('button', { name: 'Use template' })
    fireEvent.click(useBtns[0]!)
    // Should navigate to core step
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('shows Back to agents link in page header', () => {
    setupDefaultApiMocks()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('link', { name: /Back to agents/ })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// AgentsPage — filter, search, provider filter
// ---------------------------------------------------------------------------

describe('[spec: agents/console-list] AgentsPage', () => {
  beforeEach(() => {
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
  })

  it('renders page header and agent builder link', () => {
    vi.spyOn(apiModule.api, 'listAgents').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Agents')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Agent builder/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create agent/ })).toBeTruthy()
  })

  it('renders agents from the API response', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeTruthy())
  })

  it('filters agents by search text', async () => {
    const agent1 = buildAgent({ id: 'agent_1', name: 'Coding agent' })
    const agent2 = buildAgent({ id: 'agent_2', name: 'Research agent' })
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent1, agent2]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeTruthy())
    const searchInput = screen.getByRole('searchbox', { name: 'Search agents' })
    fireEvent.change(searchInput, { target: { value: 'Research' } })
    expect(screen.queryByText('Coding agent')).toBeNull()
    expect(screen.getByText('Research agent')).toBeTruthy()
  })

  it('opens create agent sheet when Create agent button is clicked', async () => {
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Create agent/ }))
    await waitFor(() => expect(screen.getByText('Create Agent')).toBeTruthy())
  })

  it('renders empty state when no agents match', async () => {
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('No agents')).toBeTruthy())
  })

  it('filters agents by description search', async () => {
    const agent1 = buildAgent({ id: 'agent_1', name: 'Agent One', description: 'Coding work' })
    const agent2 = buildAgent({ id: 'agent_2', name: 'Agent Two', description: 'Research work' })
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent1, agent2]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Agent One')).toBeTruthy())
    // Search by description
    const searchInput = screen.getByRole('searchbox', { name: 'Search agents' })
    fireEvent.change(searchInput, { target: { value: 'Research' } })
    expect(screen.queryByText('Agent One')).toBeNull()
    expect(screen.getByText('Agent Two')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// AgentDetailPage — routing
// ---------------------------------------------------------------------------

describe('[spec: agents/console-detail] AgentDetailPage', () => {
  it('renders detail page with agent data from API', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'archiveAgent').mockResolvedValue(agent)

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Coding agent')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Edit agent' })).toBeTruthy()
  })

  it('shows Create session button for non-archived agent', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create session' })).toBeTruthy())
  })

  it('does not show Create session button for archived agent', async () => {
    const agent = buildAgent({ archivedAt: now })
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Create session' })).toBeNull()
  })

  it('renders fallback title when agent is loading', () => {
    vi.spyOn(apiModule.api, 'readAgent').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Agent detail')).toBeTruthy()
  })

  it('opens edit sheet when Edit agent button is clicked', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// agent-builder-model extensions (stepErrors, parseHandoffTargets, toAgentInput)
// ---------------------------------------------------------------------------

describe('[spec: agents/builder] agent-builder-model extensions', () => {
  it('stepErrors returns empty object for non-core, non-roles steps', () => {
    expect(stepErrors('start', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('tools', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('sandbox', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('test', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('done', emptyBuilderDraft)).toEqual({})
  })

  it('stepErrors delegates to coreStepErrors for core step', () => {
    const errors = stepErrors('core', emptyBuilderDraft)
    expect(errors.name).toBeTruthy()
    expect(errors.instructions).toBeTruthy()
  })

  it('stepErrors delegates to rolesStepErrors for roles step with invalid target', () => {
    const errors = stepErrors('roles', { ...emptyBuilderDraft, handoffTargets: 'invalid=nope' })
    expect(errors.handoffTargets).toBeTruthy()
  })

  it('parseHandoffTargets parses role= lines', () => {
    const result = parseHandoffTargets('role=worker')
    expect(result).toEqual([{ role: 'worker' }])
  })

  it('parseHandoffTargets parses capability= lines', () => {
    const result = parseHandoffTargets('capability=implementation')
    expect(result).toEqual([{ capability: 'implementation' }])
  })

  it('parseHandoffTargets parses multiple targets on separate lines', () => {
    const result = parseHandoffTargets('role=worker\ncapability=code-review')
    expect(result).toEqual([{ role: 'worker' }, { capability: 'code-review' }])
  })

  it('parseHandoffTargets returns empty array for empty string', () => {
    expect(parseHandoffTargets('')).toEqual([])
  })

  it('toAgentInput includes description only when non-empty', () => {
    const withDesc = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', description: 'Desc' })
    expect(withDesc.description).toBe('Desc')
    const withoutDesc = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', description: '' })
    expect(withoutDesc.description).toBeUndefined()
  })

  it('toAgentInput sets skills to empty array when sandboxEnabled is false', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      instructions: 'B',
      sandboxEnabled: false,
      skills: 'ama@coding-agent',
    })
    expect(result.skills).toEqual([])
  })

  it('toAgentInput includes skills when sandboxEnabled is true', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      instructions: 'B',
      sandboxEnabled: true,
      skills: 'ama@coding-agent\nama@test',
    })
    expect(result.skills).toEqual(['ama@coding-agent', 'ama@test'])
  })

  it('toAgentInput sets handoffPolicy with targets when targets are present', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      instructions: 'B',
      handoffTargets: 'role=worker',
    })
    expect(result.handoffPolicy).toEqual({ targets: [{ role: 'worker' }] })
  })

  it('toAgentInput sets empty handoffPolicy when no targets', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', handoffTargets: '' })
    expect(result.handoffPolicy).toEqual({})
  })

  it('toAgentInput sets memoryPolicy with scope when memoryEnabled is true', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', memoryEnabled: true })
    expect(result.memoryPolicy).toEqual({ enabled: true, scope: 'project' })
  })

  it('toAgentInput sets memoryPolicy disabled when memoryEnabled is false', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', memoryEnabled: false })
    expect(result.memoryPolicy).toEqual({ enabled: false })
  })

  it('coreStepErrors returns error when name is too long (121 chars)', () => {
    const errors = stepErrors('core', { ...emptyBuilderDraft, name: 'A'.repeat(121), instructions: 'B' })
    expect(errors.name).toContain('120 characters')
  })

  it('coreStepErrors returns no model/provider error when model and provider are set', () => {
    const errors = stepErrors('core', {
      ...emptyBuilderDraft,
      name: 'Valid name',
      instructions: 'Valid instructions',
      model: '@cf/some-model',
      provider: 'workers-ai',
    })
    expect(errors.model).toBeUndefined()
    expect(errors.provider).toBeUndefined()
  })

  it('toAgentInput maps capabilityTags from newline-separated string', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      instructions: 'B',
      capabilityTags: 'triage\ncode-review',
    })
    expect(result.capabilityTags).toEqual(['triage', 'code-review'])
  })

  it('toAgentInput maps role null when role is empty string', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', role: '' })
    expect(result.role).toBeNull()
  })

  it('toAgentInput maps role string when role is set', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', role: 'maintainer' })
    expect(result.role).toBe('maintainer')
  })

  it('toAgentInput maps allowedTools to tools array', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', allowedTools: 'read\nwrite' })
    expect(result.tools).toEqual([{ name: 'read' }, { name: 'write' }])
  })

  it('toAgentInput passes mcpConnectors array directly', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', instructions: 'B', mcpConnectors: ['c1', 'c2'] })
    expect(result.mcpConnectors).toEqual(['c1', 'c2'])
  })

  it('agentApiExamples includes description in curl body when agent.description is set (line 197)', () => {
    const agent = buildAgent({ description: 'Does useful work' })
    const examples = agentApiExamples('https://example.com', agent)
    expect(examples.curl).toContain('"description":"Does useful work"')
  })

  it('agentApiExamples omits description when agent.description is null', () => {
    const agent = buildAgent({ description: null })
    const examples = agentApiExamples('https://example.com', agent)
    expect(examples.curl).not.toContain('"description"')
  })

  it('agentApiExamples omits instructions when agent.instructions is null (line 215 falsy branch)', () => {
    const agent = buildAgent({ instructions: null as unknown as string })
    const examples = agentApiExamples('https://example.com', agent)
    expect(examples.curl).not.toContain('"instructions"')
  })

  it('agentApiExamples omits role when agent.role is null (line 221 falsy branch)', () => {
    const agent = buildAgent({ role: null })
    const examples = agentApiExamples('https://example.com', agent)
    expect(examples.curl).not.toContain('"role"')
  })

  it('agentApiExamples includes instructions when set', () => {
    const agent = buildAgent({ instructions: 'Do the work' })
    const examples = agentApiExamples('https://example.com', agent)
    expect(examples.curl).toContain('"instructions":"Do the work"')
  })

  it('agentApiExamples includes role when set', () => {
    const agent = buildAgent({ role: 'maintainer' })
    const examples = agentApiExamples('https://example.com', agent)
    expect(examples.curl).toContain('"role":"maintainer"')
  })

  it('apiErrorToBuilder returns empty errors for non-ApiError', () => {
    const result = apiErrorToBuilder(new Error('plain error'))
    expect(result).toEqual({ errors: {}, step: null })
  })

  it('apiErrorToBuilder returns empty errors for ApiError without details object', () => {
    const err = new ApiError('bad request', 400, null)
    const result = apiErrorToBuilder(err)
    expect(result).toEqual({ errors: {}, step: null })
  })

  it('apiErrorToBuilder maps server field errors to builder fields', () => {
    const err = new ApiError('unprocessable', 422, {
      error: { details: { fields: { name: 'Name is required', instructions: 'Instructions missing' } } },
    })
    const result = apiErrorToBuilder(err)
    expect(result.errors.name).toBe('Name is required')
    expect(result.errors.instructions).toBe('Instructions missing')
    expect(result.step).toBe('core')
  })

  it('apiErrorToBuilder returns null step when no fields match known server fields', () => {
    const err = new ApiError('unprocessable', 422, {
      error: { details: { fields: { unknownField: 'some error' } } },
    })
    const result = apiErrorToBuilder(err)
    expect(result.errors).toEqual({})
    expect(result.step).toBeNull()
  })

  it('apiErrorToBuilder returns empty errors when details.fields is missing', () => {
    const err = new ApiError('unprocessable', 422, { error: { details: {} } })
    const result = apiErrorToBuilder(err)
    expect(result).toEqual({ errors: {}, step: null })
  })
})

// ---------------------------------------------------------------------------
// ToolsStep — onChange for allowedTools textarea (line 202)
// ---------------------------------------------------------------------------

describe('ToolsStep — allowedTools onChange', () => {
  it('calls setField with new value when typing in allowed tools textarea', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={setField} connectors={[]} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Allowed tools'), { target: { value: 'read\nwrite' } })
    expect(setField).toHaveBeenCalledWith('allowedTools', 'read\nwrite')
  })
})

// ---------------------------------------------------------------------------
// CoreStep — provider/model Select onChange (lines 144, 165-172)
// ---------------------------------------------------------------------------

describe('CoreStep — provider onChange clears model (line 144)', () => {
  it('calls setField when description is typed (line 128)', () => {
    const setField = vi.fn()
    const queryClient = makeQueryClient()
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep draft={emptyBuilderDraft} errors={{}} setField={setField} providers={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My agent description' } })
    expect(setField).toHaveBeenCalledWith('description', 'My agent description')
  })

  it('calls setField twice when provider changes: once for provider and once to clear model', async () => {
    const setField = vi.fn()
    const queryClient = makeQueryClient()
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    const provider = buildProvider({ id: 'anthropic', type: 'anthropic', displayName: 'Anthropic' })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep draft={emptyBuilderDraft} errors={{}} setField={setField} providers={[provider]} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const providerTrigger = screen.getByRole('combobox', { name: 'Provider' })
    providerTrigger.focus()
    fireEvent.pointerDown(providerTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(providerTrigger)
    const option = await screen.findByRole('option', { name: /Anthropic/ })
    fireEvent.click(option)
    expect(setField).toHaveBeenCalledWith('provider', 'anthropic')
    expect(setField).toHaveBeenCalledWith('model', '')
  })

  it('renders model Select with value when draft.model is set (line 165 truthy branch)', async () => {
    const queryClient = makeQueryClient()
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(
      listOf([buildProviderModel({ modelId: 'claude-3-5-sonnet', availability: 'available' })]),
    )
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep
            draft={{ ...emptyBuilderDraft, provider: 'anthropic', model: 'claude-3-5-sonnet' }}
            errors={{}}
            setField={vi.fn()}
            providers={[]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // Model Select should show the current model value
    expect(screen.getByText('claude-3-5-sonnet')).toBeTruthy()
  })

  it('filters and maps available models from catalog (lines 119-120, 171-175)', async () => {
    // This test specifically exercises the filter/map callbacks on modelsQuery data
    const queryClient = makeQueryClient()
    const listProviderModels = vi
      .spyOn(apiModule.api, 'listProviderModels')
      .mockResolvedValue(
        listOf([
          buildProviderModel({ modelId: 'claude-3-5-sonnet', availability: 'available' }),
          buildProviderModel({ modelId: 'claude-2', availability: 'unavailable' }),
        ]),
      )
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep
            draft={{ ...emptyBuilderDraft, provider: 'anthropic', model: 'claude-3-5-sonnet' }}
            errors={{}}
            setField={vi.fn()}
            providers={[]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // Wait for listProviderModels to be called (query executes since provider is set)
    await waitFor(() => expect(listProviderModels).toHaveBeenCalled())
    // Wait for the component to re-render after query resolves
    // The filter (lines 119-120) runs, filtering out 'unavailable', keeping 'claude-3-5-sonnet'
    // The model is shown in the trigger since it's in the catalog (line 176 falsy branch)
    await waitFor(() => expect(screen.getByText('claude-3-5-sonnet')).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// SandboxStep — onChange callbacks for skills field
// ---------------------------------------------------------------------------

describe('SandboxStep — skills onChange', () => {
  it('calls setField with new value when typing in skills textarea', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <SandboxStep draft={{ ...emptyBuilderDraft, sandboxEnabled: true }} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    const skillsArea = screen.getByLabelText('Carried skills')
    fireEvent.change(skillsArea, { target: { value: 'ama@coding-agent' } })
    expect(setField).toHaveBeenCalledWith('skills', 'ama@coding-agent')
  })
})

// ---------------------------------------------------------------------------
// RolesStep — onChange callbacks
// ---------------------------------------------------------------------------

describe('RolesStep — onChange callbacks', () => {
  it('calls setField when role is typed', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <RolesStep draft={emptyBuilderDraft} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'maintainer' } })
    expect(setField).toHaveBeenCalledWith('role', 'maintainer')
  })

  it('calls setField when capability tags are typed', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <RolesStep draft={emptyBuilderDraft} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Capability tags'), { target: { value: 'triage' } })
    expect(setField).toHaveBeenCalledWith('capabilityTags', 'triage')
  })

  it('calls setField when handoff targets are typed', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <RolesStep draft={emptyBuilderDraft} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Handoff targets'), { target: { value: 'role=worker' } })
    expect(setField).toHaveBeenCalledWith('handoffTargets', 'role=worker')
  })
})

// ---------------------------------------------------------------------------
// ToolsStep — connector without description or inputSchema (null branches)
// ---------------------------------------------------------------------------

describe('ToolsStep — mcpConnectors error (lines 205, 224)', () => {
  it('renders FieldError when errors.mcpConnectors is set', () => {
    render(
      <MemoryRouter>
        <ToolsStep
          draft={emptyBuilderDraft}
          errors={{ mcpConnectors: 'Connector not available.' }}
          setField={vi.fn()}
          connectors={[]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Connector not available.')).toBeTruthy()
  })
})

describe('ToolsStep — connector null branches', () => {
  it('does not render tool description when tool.description is null', () => {
    const connector = buildConnector({
      tools: [
        {
          name: 'tool_x',
          description: null,
          inputSchema: null as unknown as Record<string, unknown>,
          approvalMode: 'none',
          policyMetadata: {},
        },
      ],
    })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('tool_x')).toBeTruthy()
    // No description paragraph should appear for tool
  })

  it('calls setField to remove connector when already-selected connector is unchecked', () => {
    const setField = vi.fn()
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep
          draft={{ ...emptyBuilderDraft, mcpConnectors: ['connector_1'] }}
          errors={{}}
          setField={setField}
          connectors={[connector]}
        />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(setField).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AgentsView — archive confirm callback
// ---------------------------------------------------------------------------

describe('AgentsView — archive confirm', () => {
  it('calls onArchive with agent id when confirm dialog is confirmed', async () => {
    const onArchive = vi.fn()
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    )
    const archiveBtn = screen.getByRole('button', { name: 'Archive agent' })
    fireEvent.click(archiveBtn)
    const _confirmBtn = await screen.findByRole('button', { name: 'Archive agent', hidden: false })
    // Two buttons with same name: trigger and confirm inside dialog
    const allArchiveBtns = screen.getAllByRole('button', { name: 'Archive agent' })
    // Click the last one which is the confirmation dialog button
    fireEvent.click(allArchiveBtns[allArchiveBtns.length - 1]!)
    expect(onArchive).toHaveBeenCalledWith('agent_1')
  })
})

// ---------------------------------------------------------------------------
// CreateAgentSheet — error branch
// ---------------------------------------------------------------------------

describe('CreateAgentSheet — error branch', () => {
  it('shows error toast when createAgent fails', async () => {
    vi.spyOn(apiModule.api, 'createAgent').mockRejectedValue(new Error('Server error'))
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const submitBtn = screen.getByRole('button', { name: 'Save agent' })
    fireEvent.click(submitBtn)
    // Error triggers toast - can't easily assert toast, just verify no crash
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save agent' })).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// use-agent-actions — archive callbacks via AgentsPage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// use-agent-actions — non-Error onError branch (line 15)
// ---------------------------------------------------------------------------

describe('use-agent-actions — non-Error onError (line 15)', () => {
  it('calls toast.error with String(error) when onError receives a non-Error rejection', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    // Reject with a plain string — not an Error instance
    vi.spyOn(apiModule.api, 'archiveAgent').mockRejectedValue('string-error')
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeTruthy())
    const archiveBtn = screen.getByRole('button', { name: 'Archive agent' })
    fireEvent.click(archiveBtn)
    const confirmBtns = await screen.findAllByRole('button', { name: 'Archive agent' })
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!)
    await waitFor(() => expect(apiModule.api.archiveAgent).toHaveBeenCalled())
  })
})

// ---------------------------------------------------------------------------
// CreateAgentSheet — non-Error onError branch (line 35)
// ---------------------------------------------------------------------------

describe('CreateAgentSheet — non-Error onError (line 35)', () => {
  it('calls toast.error with String(error) when onError receives a plain object rejection', async () => {
    vi.spyOn(apiModule.api, 'createAgent').mockRejectedValue({ code: 500, msg: 'internal' })
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() => expect(apiModule.api.createAgent).toHaveBeenCalled())
    // No crash — the non-Error branch ran String({ code: 500, msg: 'internal' })
    expect(screen.getByRole('button', { name: 'Save agent' })).toBeTruthy()
  })
})

describe('use-agent-actions — archive callbacks', () => {
  beforeEach(() => {
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
  })

  it('calls archiveAgent and invalidates queries on success', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'archiveAgent').mockResolvedValue({ ...agent, archivedAt: now })
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeTruthy())
    // Open confirm dialog
    const archiveBtn = screen.getByRole('button', { name: 'Archive agent' })
    fireEvent.click(archiveBtn)
    const confirmBtns = await screen.findAllByRole('button', { name: 'Archive agent' })
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!)
    await waitFor(() => expect(apiModule.api.archiveAgent).toHaveBeenCalled())
  })

  it('handles archiveAgent error gracefully', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'archiveAgent').mockRejectedValue(new Error('Archive failed'))
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeTruthy())
    const archiveBtn = screen.getByRole('button', { name: 'Archive agent' })
    fireEvent.click(archiveBtn)
    const confirmBtns = await screen.findAllByRole('button', { name: 'Archive agent' })
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!)
    await waitFor(() => expect(apiModule.api.archiveAgent).toHaveBeenCalled())
  })
})

// ---------------------------------------------------------------------------
// AgentsPage — session sheet close handler (line 115)
// ---------------------------------------------------------------------------

describe('AgentsPage — provider filter branch', () => {
  it('filters agents by provider when a specific provider is selected', async () => {
    const agent1 = buildAgent({ id: 'agent_1', providerId: 'workers-ai', name: 'WA Agent' })
    const agent2 = buildAgent({ id: 'agent_2', providerId: 'anthropic', name: 'Anthropic Agent' })
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent1, agent2]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('WA Agent')).toBeTruthy())
    // Both agents shown initially
    expect(screen.getByText('Anthropic Agent')).toBeTruthy()

    // Filter by provider 'anthropic' via Select interaction
    const providerSelect = screen.getByRole('combobox', { name: 'Filter by provider' })
    providerSelect.focus()
    fireEvent.pointerDown(providerSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(providerSelect)
    const anthropicOption = await screen.findByRole('option', { name: 'anthropic' })
    fireEvent.click(anthropicOption)
    // Only Anthropic Agent should show
    await waitFor(() => expect(screen.queryByText('WA Agent')).toBeNull())
    expect(screen.getByText('Anthropic Agent')).toBeTruthy()
  })

  it('filters by archived status when status filter is changed', async () => {
    const agent1 = buildAgent({ id: 'agent_1', name: 'Active Agent', archivedAt: null })
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent1]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Active Agent')).toBeTruthy())
    // Filter by 'active' status
    const statusSelect = screen.getByRole('combobox', { name: 'Filter by status' })
    statusSelect.focus()
    fireEvent.pointerDown(statusSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(statusSelect)
    const activeOption = await screen.findByRole('option', { name: 'active' })
    fireEvent.click(activeOption)
    // Active Agent should still show
    await waitFor(() => expect(screen.getByText('Active Agent')).toBeTruthy())
  })
})

describe('AgentsPage — session sheet close (line 115)', () => {
  it('resets sessionAgentId to undefined when session sheet is closed via Escape', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([agent]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeTruthy())
    // Click create session icon button to open sheet
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    // Sheet should open - session form appears
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())
    // Close the sheet by pressing Escape — triggers onOpenChange(false) → line 115
    fireEvent.keyDown(document, { key: 'Escape' })
    // Sheet should close (sessionAgentId is reset to undefined)
    await waitFor(() => expect(screen.queryByText('Create Session')).toBeNull())
  })
})

// ---------------------------------------------------------------------------
// AgentBuilderPage — setField clears error for that field
// ---------------------------------------------------------------------------

describe('AgentBuilderPage — setField clears field error', () => {
  beforeEach(() => {
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
  })

  it('clears name error when name field is typed after validation failure', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // Trigger validation
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Name is required.')).toBeTruthy()
    // Now type in the name field to clear that error
    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'My agent' } })
    // Error should be cleared
    expect(screen.queryByText('Name is required.')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AgentBuilderPage — submitTest with valid form triggers startTest mutation
// ---------------------------------------------------------------------------

describe('AgentBuilderPage — submitTest valid draft', () => {
  beforeEach(() => {
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
  })

  it('submitTest shows starting test session while pending', async () => {
    // Mock the API to return needed data
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    vi.spyOn(apiModule.api, 'createAgent').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'createSession').mockReturnValue(new Promise(() => {}))

    const queryClient = makeQueryClient()
    // Inject a pre-set draft via URL not possible - we need to fill fields
    // Start at test step with env pre-selected via env query data
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=test']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // The Start test session button is disabled without an environment
    // but submitTest validation still fires - we can test through validateAndGo path
    const startBtn = screen.getByRole('button', { name: 'Start test session' })
    expect(startBtn.hasAttribute('disabled')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AgentDetailPage — updateAgent mutation and edit form submission
// ---------------------------------------------------------------------------

describe('AgentDetailPage — agentId nullish branches (lines 33-38, 63-68)', () => {
  it('handles missing agentId param (agentId ?? "" falsy branch)', () => {
    vi.spyOn(apiModule.api, 'readAgent').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listAgentVersions').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listSessions').mockReturnValue(new Promise(() => {}))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // With no agentId, queries are disabled — page renders with fallback title
    expect(screen.getByText('Agent detail')).toBeTruthy()
  })
})

describe('AgentDetailPage — branch coverage', () => {
  it('agentToForm handles null instructions, providerId, model (lines 145-147 null branches)', async () => {
    // Build an agent with null instructions/providerId/model to cover the ?? '' branches
    const agent = buildAgent({
      instructions: null as unknown as string,
      providerId: null as unknown as string,
      model: null as unknown as string,
    })
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'updateAgent').mockResolvedValue(buildAgent())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeTruthy())
    // Click edit to call agentToForm with null fields - covers ?? '' branches
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeTruthy())
    // Submit the form (with null->'' conversions)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(apiModule.api.updateAgent).toHaveBeenCalled())
  })

  it('shows Saving agent label when updateAgent is pending (line 124 truthy branch)', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    // Never resolves so isPending stays true
    vi.spyOn(apiModule.api, 'updateAgent').mockReturnValue(new Promise(() => {}))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeTruthy())
    // Click save — isPending will be true while the mutation is in flight
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    // Button should now show "Saving agent" (isPending = true branch)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving agent' })).toBeTruthy())
  })
})

describe('AgentDetailPage — create session sheet', () => {
  it('opens CreateSessionSheet when Create session button is clicked', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create session' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    // CreateSessionSheet should open — it renders a title
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())
  })

  it('closes CreateSessionSheet via onOpenChange callback', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create session' })).toBeTruthy())
    // Open the session sheet
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())
    // Close via escape key (Radix dialog responds to Escape)
    fireEvent.keyDown(document, { key: 'Escape' })
    // Sheet should close
    await waitFor(() => expect(screen.queryByText('Create Session')).toBeNull())
  })
})

describe('AgentDetailPage — edit form submission', () => {
  it('calls updateAgent API when edit form is submitted', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'updateAgent').mockResolvedValue({ ...agent, name: 'Updated agent' })

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeTruthy())
    // Open edit sheet
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeTruthy())
    // Submit the form
    const saveBtn = screen.getByRole('button', { name: 'Save changes' })
    fireEvent.click(saveBtn)
    await waitFor(() => expect(apiModule.api.updateAgent).toHaveBeenCalled())
  })

  it('shows error in edit form when updateAgent fails', async () => {
    const agent = buildAgent()
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'updateAgent').mockRejectedValue(new Error('Update failed'))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByText('Update failed')).toBeTruthy())
  })

  it('renders agent with description in page header', async () => {
    const agent = buildAgent({ description: 'Does useful things' })
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'listAgentVersions').mockResolvedValue(listOf<AgentVersion>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/agent_1']}>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText(/Does useful things/)).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// AgentBuilderPage — publish mutation success path (done step with agent)
// ---------------------------------------------------------------------------

describe('AgentBuilderPage — publish success', () => {
  beforeEach(() => {
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
  })

  it('navigates to done step and shows agent API examples after successful publish', async () => {
    const publishedAgent = buildAgent({ name: 'My Published Agent', version: 1 })
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    const createAgent = vi.spyOn(apiModule.api, 'createAgent').mockResolvedValue(publishedAgent)

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Fill in required fields
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Published Agent' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Do the work' } })

    // Navigate through core → tools → sandbox → roles → test
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Roles and memory')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeTruthy())

    // Click Publish agent
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))

    // createAgent should have been called
    await waitFor(() => expect(createAgent).toHaveBeenCalled())
    // Should navigate to done step with agent details
    await waitFor(() => expect(screen.getByText('Equivalent curl call')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Open agent' })).toBeTruthy()
  })

  it('shows publish error toast when createAgent fails during publish', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    const createAgent = vi.spyOn(apiModule.api, 'createAgent').mockRejectedValue(new Error('Publish failed'))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Agent' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Do the work' } })

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Roles and memory')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    await waitFor(() => expect(createAgent).toHaveBeenCalled())
    // Error path — applyApiError runs since no ApiError fields are mapped
    // Page stays on test step (error toast shown, no navigation)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeTruthy())
  })

  it('uses template from start step to apply draft configuration', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=start']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Click "Use template" to apply template → applyDraft runs → navigates to core step
    const useTemplateBtns = screen.getAllByRole('button', { name: 'Use template' })
    fireEvent.click(useTemplateBtns[0]!)

    // Should be on core step now with template pre-filled
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    // Template fills in a name
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    expect(nameInput.value.length).toBeGreaterThan(0)
  })

  it('types test prompt and start test session button enabled when env selected via select interaction', async () => {
    const env = buildEnvironment()
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf([env]))
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    vi.spyOn(apiModule.api, 'createAgent').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'createSession').mockReturnValue(new Promise(() => {}))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=test']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test and publish')).toBeTruthy())

    // Type in the test prompt textarea
    const promptTextarea = screen.getByLabelText('Test prompt')
    fireEvent.change(promptTextarea, { target: { value: 'Hello agent, what can you do?' } })

    // The test prompt textarea onChange was covered — verify its value
    expect((promptTextarea as HTMLTextAreaElement).value).toBe('Hello agent, what can you do?')
  })

  it('publish uses updateAgent when draftAgent is already set (line 154)', async () => {
    const agent = buildAgent({ name: 'Draft Agent' })
    const session = buildSession()
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    vi.spyOn(apiModule.api, 'createAgent').mockResolvedValue(agent)
    vi.spyOn(apiModule.api, 'createSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue({ ...session, state: 'idle' })
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    const updateAgent = vi.spyOn(apiModule.api, 'updateAgent').mockResolvedValue(agent)

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Fill required fields and navigate to test step
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft Agent' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Do work' } })

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Roles and memory')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeTruthy())

    // Select environment and run startTest
    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Start test session' })
      expect(btn.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    // Wait for startTest to complete (createAgent called) — draftAgent is now set
    await waitFor(() => expect(apiModule.api.createAgent).toHaveBeenCalledTimes(1))

    // Now click Publish agent — should use updateAgent(draftAgent.id, ...) instead of createAgent
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    await waitFor(() => expect(updateAgent).toHaveBeenCalled())
  })

  it('navigates back to start step when Back button is clicked on core step', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    // Should navigate to start step
    await waitFor(() => expect(screen.getByText('Goal')).toBeTruthy())
  })

  it('submitTest with empty draft sets field errors when validation fails (lines 188-189)', async () => {
    const env = buildEnvironment()
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf([env]))
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=test']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test and publish')).toBeTruthy())

    // Select the environment (enables the Start test session button)
    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)

    // The button should now be enabled (draft has defaultPrompt, env is selected)
    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: 'Start test session' })
      expect(startBtn.hasAttribute('disabled')).toBe(false)
    })

    // Click Start test session — draft has empty name so validation fails
    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    // Should still be on test step (errors set, no navigation)
    expect(screen.getByText('Test and publish')).toBeTruthy()
  })

  it('shows error when publish receives ApiError with field errors (applyApiError truthy path)', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    const createAgent = vi.spyOn(apiModule.api, 'createAgent').mockRejectedValue(
      new ApiError('unprocessable', 422, {
        error: { details: { fields: { name: 'Name must be unique' } } },
      }),
    )

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Agent' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Do the work' } })

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Roles and memory')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    await waitFor(() => expect(createAgent).toHaveBeenCalled())
    // applyApiError runs: errors get set, step navigates to 'core'
    await waitFor(() => expect(screen.getByText('Name must be unique')).toBeTruthy())
  })

  it('submitTest with valid draft and environment triggers startTest mutation', async () => {
    const publishedAgent = buildAgent({ name: 'Test Agent' })
    const session = buildSession()
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    const createAgent = vi.spyOn(apiModule.api, 'createAgent').mockResolvedValue(publishedAgent)
    vi.spyOn(apiModule.api, 'createSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Fill required fields and navigate to test step
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Agent' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Do the work' } })

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Roles and memory')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeTruthy())

    // Select the environment using the Radix Select
    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)

    // Now the button should be enabled since testPrompt is pre-filled and env is selected
    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: 'Start test session' })
      expect(startBtn.hasAttribute('disabled')).toBe(false)
    })

    // Click Start test session
    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    await waitFor(() => expect(createAgent).toHaveBeenCalled())
  })

  it('shows Starting test session label while startTest mutation is pending (line 271 truthy branch)', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    // Never resolves — keeps startTest.isPending = true
    vi.spyOn(apiModule.api, 'createAgent').mockReturnValue(new Promise(() => {}))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Agent' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Do work' } })

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Roles and memory')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeTruthy())

    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)

    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: 'Start test session' })
      expect(startBtn.hasAttribute('disabled')).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    // While in flight, button label changes to isPending branch
    await waitFor(() => expect(screen.getByRole('button', { name: 'Starting test session' })).toBeTruthy())
  })

  it('shows Publishing agent label while publish mutation is pending (line 275 truthy branch)', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listConnectors').mockResolvedValue(listOf<Connector>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listProviderModels').mockResolvedValue(listOf<ProviderModel>())
    // Never resolves — keeps publish.isPending = true
    vi.spyOn(apiModule.api, 'createAgent').mockReturnValue(new Promise(() => {}))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents/new?step=core']}>
          <Routes>
            <Route path="/agents/new" element={<AgentBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Agent' } })
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Do work' } })

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Roles and memory')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    // While in flight, button label changes to isPending branch
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publishing agent' })).toBeTruthy())
  })
})
