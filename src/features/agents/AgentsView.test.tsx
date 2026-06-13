/**
 * AgentsView — pure component tests (no API, no MSW needed).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Agent } from '@/lib/api'
import { AgentsView } from './AgentsView'

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

describe('[spec: agents/console-list] AgentsView', () => {
  it('renders empty state when no agents', () => {
    render(
      <MemoryRouter>
        <AgentsView agents={[]} pagination={buildPagination([])} onCreateSession={vi.fn()} onArchive={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('No agents')).toBeInTheDocument()
  })

  it('renders a table row per agent with name, status, model, skills, tools, and version', () => {
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
    expect(screen.getByText('Coding agent')).toBeInTheDocument()
    expect(screen.getByText('workers-ai / @cf/moonshotai/kimi-k2.6')).toBeInTheDocument()
    expect(screen.getByText('ama@coding-agent')).toBeInTheDocument()
    expect(screen.getByText('read, write')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
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
    expect(screen.getByText('agent_1')).toBeInTheDocument()
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
    expect(screen.getByText('Does stuff')).toBeInTheDocument()
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
    expect(screen.getByText('archived')).toBeInTheDocument()
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
    expect(screen.getByText('None / None')).toBeInTheDocument()
  })

  it('calls onArchive with agent id when archive confirm dialog is confirmed', async () => {
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
    const allArchiveBtns = await screen.findAllByRole('button', { name: 'Archive agent' })
    fireEvent.click(allArchiveBtns[allArchiveBtns.length - 1]!)
    expect(onArchive).toHaveBeenCalledWith('agent_1')
  })
})
