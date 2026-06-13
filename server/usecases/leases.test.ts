import { describe, expect, it, vi } from 'vitest'
import { runtimeProviderModelCapability } from '../runtime/catalog'
import type { Deps } from './deps'
import { claimLease, materializeWorkItemPayload } from './leases'
import {
  type AuthScope,
  type LeaseRecord,
  type RunnerAuthRecord,
  RunnerConflictError,
  type WorkItemClaimCandidate,
  type WorkItemRecord,
} from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const CAP = runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4')
const scope = { organizationId: 'org_1', projectId: 'project_1' }

function runner(overrides: Partial<RunnerAuthRecord> = {}): RunnerAuthRecord {
  return {
    id: 'runner_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Runner',
    capabilities: [CAP],
    environmentId: null,
    credentialRef: null,
    authMode: 'oidc',
    state: 'active',
    currentLoad: 0,
    maxConcurrent: 2,
    runtimeUsage: [],
    runtimeInventory: [],
    metadata: {},
    oidcSubject: 'sub_1',
    oidcClientId: 'cid',
    lastHeartbeatAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const lease: LeaseRecord = {
  id: 'lease_1',
  workItemId: 'work_1',
  runnerId: 'runner_1',
  state: 'active',
  expiresAt: '2999-01-01T00:00:00.000Z',
  renewedAt: null,
  resumeToken: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function candidate(overrides: Partial<WorkItemClaimCandidate> = {}): WorkItemClaimCandidate {
  return {
    state: 'available',
    availableAt: '2026-01-01T00:00:00.000Z',
    environmentId: null,
    sessionId: 'session_1',
    rawPayload: { type: 'session.start', requiredRunnerCapability: CAP },
    ...overrides,
  }
}

function fakeDeps(overrides: {
  leases?: Partial<Deps['leases']>
  workItems?: Partial<Deps['workItems']>
  resolve?: Deps['runtimeSecretEnv']['resolve']
}): Deps {
  const leases: Deps['leases'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => lease,
    claimCandidate: async () => candidate(),
    expireStale: async () => {},
    claim: async () => ({ lease, sessionId: 'session_1' }),
    failClaim: async () => {},
    finish: async () => lease,
    prepareSessionChannel: async () => ({ ok: false, status: 409, message: 'n/a' }),
    rollbackSessionChannel: async () => {},
    ...overrides.leases,
  }
  const workItems: Deps['workItems'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    rawPayload: async () => ({ type: 'session.start' }),
    activeLeaseRunnerId: async () => null,
    ...overrides.workItems,
  }
  const runtimeSecretEnv: Deps['runtimeSecretEnv'] = {
    resolve: overrides.resolve ?? (async () => ({})),
  }
  return { leases, workItems, runtimeSecretEnv } as unknown as Deps
}

describe('claimLease', () => {
  it('claims an eligible available work item', async () => {
    const result = await claimLease(fakeDeps({}), auth, runner(), { workItemId: 'work_1', leaseDurationSeconds: 60 })
    expect(result.id).toBe('lease_1')
  })

  it('rejects an inactive runner', async () => {
    await expect(
      claimLease(fakeDeps({}), auth, runner({ state: 'draining' }), { workItemId: 'work_1', leaseDurationSeconds: 60 }),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('404s when the work item is missing', async () => {
    const error = await claimLease(fakeDeps({ leases: { claimCandidate: async () => null } }), auth, runner(), {
      workItemId: 'work_missing',
      leaseDurationSeconds: undefined,
    }).catch((e) => e)
    expect(error).toBeInstanceOf(RunnerConflictError)
    expect((error as RunnerConflictError).status).toBe(404)
  })

  it('conflicts when the runner is not capability-eligible', async () => {
    await expect(
      claimLease(fakeDeps({}), auth, runner({ capabilities: ['node'] }), {
        workItemId: 'work_1',
        leaseDurationSeconds: 60,
      }),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('maps the at-capacity claim race to a conflict', async () => {
    await expect(
      claimLease(fakeDeps({ leases: { claim: async () => 'at_capacity' } }), auth, runner(), {
        workItemId: 'work_1',
        leaseDurationSeconds: 60,
      }),
    ).rejects.toThrow('Runner is at capacity')
  })

  it('maps the lost work-item race to a conflict', async () => {
    await expect(
      claimLease(fakeDeps({ leases: { claim: async () => 'work_item_lost' } }), auth, runner(), {
        workItemId: 'work_1',
        leaseDurationSeconds: 60,
      }),
    ).rejects.toThrow('claimed by another runner')
  })

  it('fails the claim when claim-time secret resolution fails', async () => {
    const failClaim = vi.fn(async () => {})
    await expect(
      claimLease(
        fakeDeps({
          leases: {
            claimCandidate: async () =>
              candidate({
                rawPayload: { type: 'session.start', requiredRunnerCapability: CAP, runtimeSecretEnv: [{}] },
              }),
            failClaim,
          },
          resolve: async () => {
            throw new Error('credential revoked')
          },
        }),
        auth,
        runner(),
        { workItemId: 'work_1', leaseDurationSeconds: 60 },
      ),
    ).rejects.toThrow('credential revoked')
    expect(failClaim).toHaveBeenCalledOnce()
  })
})

describe('materializeWorkItemPayload', () => {
  it('passes through a non-session-start payload unchanged', async () => {
    const deps = fakeDeps({ workItems: { rawPayload: async () => ({ type: 'maintenance', foo: 1 }) } })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload).toEqual({ type: 'maintenance', foo: 1 })
  })

  it('resolves secret env into runtimeEnv for session starts', async () => {
    const deps = fakeDeps({
      workItems: {
        rawPayload: async () => ({
          type: 'session.start',
          runtimeEnv: { EXISTING: 'a' },
          runtimeSecretEnv: [{ name: 'TOKEN', credentialRef: { credentialId: 'cred_1' } }],
        }),
      },
      resolve: async () => ({ TOKEN: 'secret' }),
    })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload.runtimeEnv).toEqual({ EXISTING: 'a', TOKEN: 'secret' })
  })
})
