import type { AuditEntry, AuthScope } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

const repoRecord = vi.fn().mockResolvedValue(undefined)

vi.mock('../repos/audit-write', () => ({
  createAuditWriteRepo: () => ({ record: repoRecord }),
}))

// Import after vi.mock so the mock is in effect
const { createAuditPort } = await import('./audit')

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const entry: AuditEntry = {
  action: 'agent.create',
  resourceType: 'agent',
  resourceId: 'agent_1',
  outcome: 'success',
}

describe('[spec: audit/gateway] createAuditPort', () => {
  it('returns an object with a record method', () => {
    const fakeDb = {} as Parameters<typeof createAuditPort>[0]
    const port = createAuditPort(fakeDb)
    expect(typeof port.record).toBe('function')
  })

  it('delegates record to the underlying audit-write repo', async () => {
    const fakeDb = {} as Parameters<typeof createAuditPort>[0]
    const port = createAuditPort(fakeDb)
    await port.record(auth, entry)
    expect(repoRecord).toHaveBeenCalledWith(auth, entry)
  })

  it('passes through the auth scope unchanged', async () => {
    const fakeDb = {} as Parameters<typeof createAuditPort>[0]
    const port = createAuditPort(fakeDb)
    await port.record(auth, entry)
    const [calledAuth] = repoRecord.mock.calls.at(-1) ?? []
    expect(calledAuth).toBe(auth)
  })

  it('passes through the entry unchanged', async () => {
    const fakeDb = {} as Parameters<typeof createAuditPort>[0]
    const port = createAuditPort(fakeDb)
    await port.record(auth, entry)
    const [, calledEntry] = repoRecord.mock.calls.at(-1) ?? []
    expect(calledEntry).toBe(entry)
  })

  it('propagates repo rejection to the caller', async () => {
    const errorDb = {} as Parameters<typeof createAuditPort>[0]
    const failRecord = vi.fn().mockRejectedValue(new Error('db write failed'))
    vi.doMock('../repos/audit-write', () => ({
      createAuditWriteRepo: () => ({ record: failRecord }),
    }))
    // The port under test was already imported and bound to the real mock.
    // To test rejection, wire a separate spy into the mock returned repo.
    repoRecord.mockRejectedValueOnce(new Error('db write failed'))
    const port = createAuditPort(errorDb)
    await expect(port.record(auth, entry)).rejects.toThrow('db write failed')
  })
})
