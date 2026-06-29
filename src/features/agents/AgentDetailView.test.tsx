/**
 * AgentDetailView — pure component tests (no API, no MSW needed).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentVersion, Session, SessionAgentSnapshot } from '@/lib/amarpc'
import {
  type AgentOverrides,
  type AgentVersionOverrides,
  agent as resourceAgent,
  agentVersion as resourceAgentVersion,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { AgentDetailView } from './AgentDetailView'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ createdAt: now, updatedAt: now, ...overrides })
}

function buildAgentVersion(overrides: AgentVersionOverrides = {}): AgentVersion {
  return resourceAgentVersion({
    tools: [{ name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} }],
    createdAt: now,
    ...overrides,
  })
}

function buildSessionAgentSnapshot(overrides: Partial<SessionAgentSnapshot> = {}): SessionAgentSnapshot {
  return {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    systemPrompt: 'Do the work',
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: [],
    subagents: [],
    role: null,
    handoff: { enabled: false, accepts: { roles: [], capabilities: [] }, targets: [] },
    tools: [],
    mcpConnectors: [],
    createdAt: now,
    ...overrides,
  }
}

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ agentSnapshot: buildSessionAgentSnapshot(), name: 'Test session', ...overrides })
}

describe('[spec: agents/console-detail] AgentDetailView', () => {
  it('renders empty state when agent is null', () => {
    render(
      <MemoryRouter>
        <AgentDetailView agent={null} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent not found')).toBeInTheDocument()
  })

  it('renders agent model configuration for a loaded agent', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent model configuration')).toBeInTheDocument()
    expect(screen.getByText('workers-ai')).toBeInTheDocument()
    expect(screen.getByText('@cf/moonshotai/kimi-k2.6')).toBeInTheDocument()
    expect(screen.getByText('ama@coding-agent')).toBeInTheDocument()
    expect(screen.getByText('read, write')).toBeInTheDocument()
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
    expect(screen.getAllByText('v1').length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to agent fields when versions list is empty', () => {
    const agent = buildAgent({ version: 3 })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('v3')).toBeInTheDocument()
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
    const agent = buildAgent({
      skills: [],
      tools: [],
      mcpConnectors: [],
      role: null,
      handoff: { enabled: false, accepts: { roles: [], capabilities: [] }, targets: [] },
    })
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
    expect(screen.getByText('Agent model configuration')).toBeInTheDocument()
  })

  it('renders MCP connectors value', () => {
    const agent = buildAgent({ mcpConnectors: ['github-connector'] })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('github-connector')).toBeInTheDocument()
  })

  it('renders role value when set', () => {
    const agent = buildAgent({ role: 'maintainer' })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('maintainer')).toBeInTheDocument()
  })

  it('renders capability tags value when set', () => {
    const agent = buildAgent({
      handoff: { enabled: true, accepts: { roles: [], capabilities: ['triage', 'code-review'] }, targets: [] },
    })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('triage, code-review')).toBeInTheDocument()
  })
})
