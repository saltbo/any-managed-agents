import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { createFederatedTenant, updateFederatedTenant } from './federated-tenants'
import { type AuthScope, FederatedTenantConflictError, type FederatedTenantRecord } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function tenantRecord(overrides: Partial<FederatedTenantRecord> = {}): FederatedTenantRecord {
  return {
    id: 'ftn_1',
    issuer: 'https://ak.example.com',
    externalTenantId: 'org_external_1',
    projectId: 'project_1',
    environmentId: null,
    capabilities: [],
    enabled: true,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['federatedTenants']> = {}): Deps {
  const federatedTenants: Deps['federatedTenants'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    findByIssuerTenant: async () => null,
    insert: async (input, timestamp) => tenantRecord({ ...input, createdAt: timestamp, updatedAt: timestamp }),
    update: async (_p, id, fields, updatedAt) => tenantRecord({ id, ...fields, updatedAt }),
    delete: async () => {},
    ...repo,
  }
  return { federatedTenants } as unknown as Deps
}

describe('createFederatedTenant', () => {
  it('normalizes a trailing-slash issuer', async () => {
    const tenant = await createFederatedTenant(fakeDeps(), auth, {
      issuer: 'https://ak.example.com/',
      externalTenantId: 'org_external_1',
      environmentId: null,
      capabilities: ['session:poll'],
      metadata: {},
    })
    expect(tenant.issuer).toBe('https://ak.example.com')
  })

  it('rejects a duplicate issuer/tenant pair', async () => {
    const deps = fakeDeps({ findByIssuerTenant: async () => ({ id: 'ftn_existing' }) })
    await expect(
      createFederatedTenant(deps, auth, {
        issuer: 'https://ak.example.com',
        externalTenantId: 'org_external_1',
        environmentId: null,
        capabilities: [],
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(FederatedTenantConflictError)
  })
})

describe('updateFederatedTenant', () => {
  it('merges only the provided fields', async () => {
    const existing = tenantRecord({ enabled: true, capabilities: ['session:poll', 'session:claim'] })
    const updated = await updateFederatedTenant(fakeDeps(), auth, existing, { enabled: false })
    expect(updated.enabled).toBe(false)
    expect(updated.capabilities).toEqual(['session:poll', 'session:claim'])
  })

  it('clears environmentId with an explicit null', async () => {
    const existing = tenantRecord({ environmentId: 'env_1' })
    const updated = await updateFederatedTenant(fakeDeps(), auth, existing, { environmentId: null })
    expect(updated.environmentId).toBeNull()
  })
})
