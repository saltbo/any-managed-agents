import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { VaultDetailView } from '@/features/vaults/VaultDetailView'
import { VaultsView } from '@/features/vaults/VaultsView'
import type { Vault, VaultCredential } from '@/lib/api'

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

function vault(overrides: Partial<Vault> = {}): Vault {
  return {
    id: 'vault_1',
    projectId: 'project_1',
    name: 'Provider credentials',
    description: 'Model provider tokens',
    scope: 'project',
    metadata: {},
    archivedAt: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function credential(overrides: Partial<VaultCredential> = {}): VaultCredential {
  return {
    id: 'vaultcred_1',
    vaultId: 'vault_1',
    projectId: 'project_1',
    name: 'OpenAI key',
    type: 'api_key',
    connectorBinding: {},
    metadata: {},
    state: 'active',
    activeVersionId: 'vaultver_1',
    activeVersion: {
      id: 'vaultver_1',
      credentialId: 'vaultcred_1',
      vaultId: 'vault_1',
      projectId: 'project_1',
      version: 2,
      provider: 'cloudflare-secrets',
      secretRef: 'cloudflare-secret:AMA_VAULTCRED_1_V2',
      externalVaultPath: null,
      referenceName: 'AMA_VAULTCRED_1_V2',
      state: 'active',
      hasSecret: true,
      metadata: {},
      createdAt: '2026-05-23T00:00:00.000Z',
      supersededAt: null,
      revokedAt: null,
    },
    revokedAt: null,
    revokedByUserId: null,
    revokeReason: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

describe('[spec: vaults/console-list] VaultsView', () => {
  it('shows the empty-state create affordance when no vaults exist', () => {
    render(
      <MemoryRouter>
        <VaultsView vaults={[]} pagination={pagination<Vault>([])} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No vaults')).toBeTruthy()
    expect(screen.getByText(/Create a vault to track safe credential references/)).toBeTruthy()
  })

  it('renders vault rows with display name, scope, status, and timestamps', () => {
    const vaults = [vault()]
    render(
      <MemoryRouter>
        <VaultsView vaults={vaults} pagination={pagination(vaults)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Provider credentials' }).getAttribute('href')).toBe('/vaults/vault_1')
    expect(screen.getByText('project')).toBeTruthy()
    expect(screen.getByText('1-1 of 1')).toBeTruthy()
  })
})

describe('[spec: vaults/console-list] VaultDetailView', () => {
  it('renders credential metadata with safe references and redacts raw secret values', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[credential()]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Credential metadata')).toBeTruthy()
    expect(screen.getByText('Raw secret values are not returned by the control plane.')).toBeTruthy()
    expect(screen.getByText('OpenAI key')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('AMA_VAULTCRED_1_V2')).toBeTruthy()
  })
})
