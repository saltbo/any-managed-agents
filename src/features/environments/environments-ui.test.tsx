import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { EnvironmentDetailView } from '@/features/environments/EnvironmentDetailView'
import { EnvironmentsView } from '@/features/environments/EnvironmentsView'
import type { Environment, Session } from '@/lib/api'

afterEach(() => {
  cleanup()
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
})

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
})
