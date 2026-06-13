import type { SessionApprovalRecord, SessionRecord, SessionRepo } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'
import { createSessionRuntimeGateway } from './session-runtime'

// Stub the entire orchestration module — all functions are replaced by vi.fn()
// so tests control their return values without touching any real runtime logic.
vi.mock('../../runtime/session-orchestration', () => ({
  createSessionForAgent: vi.fn(),
  dispatchSessionPrompt: vi.fn(),
  stopSession: vi.fn(),
  archiveSession: vi.fn(),
  unarchiveSession: vi.fn(),
  decideSessionApproval: vi.fn(),
  markExpiredPendingSessions: vi.fn(),
}))

import {
  archiveSession as archiveSessionRuntime,
  createSessionForAgent,
  decideSessionApproval,
  dispatchSessionPrompt,
  markExpiredPendingSessions,
  stopSession as stopSessionRuntime,
  unarchiveSession as unarchiveSessionRuntime,
} from '../../runtime/session-orchestration'

// ── helpers ──────────────────────────────────────────────────────────────────

function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'sess_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: {},
    environmentId: null,
    environmentVersionId: null,
    environmentSnapshot: null,
    title: null,
    resourceRefs: [],
    env: {},
    secretEnv: [],
    runtimeMetadata: {
      hostingMode: 'cloud',
      runtime: 'cloudflare',
      runtimeConfig: {},
      provider: 'workers-ai',
      model: null,
      driver: null,
      backend: null,
      protocol: null,
    },
    state: 'running',
    stateReason: null,
    metadata: {},
    startedAt: null,
    stoppedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function approvalRecord(overrides: Partial<SessionApprovalRecord> = {}): SessionApprovalRecord {
  return {
    id: 'appr_1',
    sessionId: 'sess_1',
    toolCallId: 'tc_1',
    toolName: 'tool',
    input: {},
    relatedEventIds: [],
    state: 'approved',
    reason: null,
    result: null,
    requestedAt: '2026-01-01T00:00:00.000Z',
    decidedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const auth = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const sessionRuntimeRow = {
  id: 'sess_1',
  projectId: 'project_1',
  organizationId: 'org_1',
  state: 'running',
  archivedAt: null,
  sandboxId: null,
  metadata: {},
}

function fakeRepo(overrides: Partial<SessionRepo> = {}): SessionRepo {
  return {
    list: vi.fn(),
    find: vi.fn(async () => sessionRecord()),
    findRuntimeRow: vi.fn(),
    readConnection: vi.fn(),
    updateFields: vi.fn(),
    listMessages: vi.fn(),
    findMessage: vi.fn(),
    insertMessage: vi.fn(),
    queryEvents: vi.fn(),
    insertEvents: vi.fn(),
    listApprovals: vi.fn(),
    findApproval: vi.fn(async () => approvalRecord()),
    activeSessionLeaseForRunner: vi.fn(),
    ...overrides,
  } as unknown as SessionRepo
}

function fakeEnv() {
  return {} as unknown as Parameters<typeof createSessionRuntimeGateway>[0]
}

function fakeDb() {
  return {} as unknown as Parameters<typeof createSessionRuntimeGateway>[1]
}

// ── createSession ─────────────────────────────────────────────────────────────

describe('createSessionRuntimeGateway — createSession', () => {
  it('calls createSessionForAgent with mapped args and re-reads via repo on success', async () => {
    const runtimeSession = { id: 'sess_1' }
    vi.mocked(createSessionForAgent).mockResolvedValueOnce({ ok: true, session: runtimeSession } as never)

    const canonical = sessionRecord({ state: 'running' })
    const repo = fakeRepo({ find: vi.fn(async () => canonical) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    const result = await gw.createSession(auth, {
      agentId: 'agent_1',
      environmentId: 'env_1',
      options: { runtime: 'cloudflare' },
      requestId: 'req_1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(canonical)
    }
    expect(repo.find).toHaveBeenCalledWith('project_1', 'sess_1')
  })

  it('returns error when createSessionForAgent fails', async () => {
    const runtimeError = { status: 409, code: 'conflict', message: 'Already exists' }
    vi.mocked(createSessionForAgent).mockResolvedValueOnce({ ok: false, error: runtimeError } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())

    const result = await gw.createSession(auth, {
      agentId: 'agent_1',
      environmentId: 'env_1',
      options: { runtime: 'cloudflare' },
      requestId: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual(runtimeError)
    }
  })

  it('throws when repo.find returns null after successful runtime createSession', async () => {
    vi.mocked(createSessionForAgent).mockResolvedValueOnce({ ok: true, session: { id: 'sess_1' } } as never)

    const repo = fakeRepo({ find: vi.fn(async () => null) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    await expect(
      gw.createSession(auth, {
        agentId: 'agent_1',
        environmentId: 'env_1',
        options: { runtime: 'cloudflare' },
        requestId: null,
      }),
    ).rejects.toThrow('Session row is required after a runtime operation')
  })
})

// ── stopSession ───────────────────────────────────────────────────────────────

describe('createSessionRuntimeGateway — stopSession', () => {
  it('calls stopSessionRuntime and re-reads via repo on success', async () => {
    const stopped = sessionRecord({ state: 'stopped' })
    vi.mocked(stopSessionRuntime).mockResolvedValueOnce({ ok: true, session: { id: 'sess_1' } } as never)

    const repo = fakeRepo({ find: vi.fn(async () => stopped) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    const result = await gw.stopSession(auth, sessionRuntimeRow, 'req_1', 'user request')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(stopped)
    }
    expect(repo.find).toHaveBeenCalledWith('project_1', 'sess_1')
  })

  it('returns error when stopSessionRuntime fails', async () => {
    const runtimeError = { status: 409, code: 'already_stopped', message: 'Already stopped' }
    vi.mocked(stopSessionRuntime).mockResolvedValueOnce({ ok: false, error: runtimeError } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    const result = await gw.stopSession(auth, sessionRuntimeRow, null)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('already_stopped')
    }
  })

  it('throws when repo.find returns null after successful stop', async () => {
    vi.mocked(stopSessionRuntime).mockResolvedValueOnce({ ok: true, session: { id: 'sess_1' } } as never)
    const repo = fakeRepo({ find: vi.fn(async () => null) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    await expect(gw.stopSession(auth, sessionRuntimeRow, null)).rejects.toThrow(
      'Session row is required after a runtime operation',
    )
  })
})

// ── archiveSession ────────────────────────────────────────────────────────────

describe('createSessionRuntimeGateway — archiveSession', () => {
  it('calls archiveSessionRuntime and re-reads via repo on success', async () => {
    const archived = sessionRecord({ archivedAt: '2026-01-02T00:00:00.000Z' })
    vi.mocked(archiveSessionRuntime).mockResolvedValueOnce({ ok: true, session: { id: 'sess_1' } } as never)

    const repo = fakeRepo({ find: vi.fn(async () => archived) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    const result = await gw.archiveSession(auth, sessionRuntimeRow, 'req_1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(archived)
    }
  })

  it('returns error when archiveSessionRuntime fails', async () => {
    const runtimeError = { status: 409, code: 'conflict', message: 'Cannot archive' }
    vi.mocked(archiveSessionRuntime).mockResolvedValueOnce({ ok: false, error: runtimeError } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    const result = await gw.archiveSession(auth, sessionRuntimeRow, null)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('conflict')
    }
  })

  it('throws when repo.find returns null after successful archive', async () => {
    vi.mocked(archiveSessionRuntime).mockResolvedValueOnce({ ok: true, session: { id: 'sess_1' } } as never)
    const repo = fakeRepo({ find: vi.fn(async () => null) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    await expect(gw.archiveSession(auth, sessionRuntimeRow, null)).rejects.toThrow(
      'Session row is required after a runtime operation',
    )
  })
})

// ── unarchiveSession ──────────────────────────────────────────────────────────

describe('createSessionRuntimeGateway — unarchiveSession', () => {
  it('calls unarchiveSessionRuntime and re-reads via repo', async () => {
    vi.mocked(unarchiveSessionRuntime).mockResolvedValueOnce(undefined as never)

    const live = sessionRecord()
    const repo = fakeRepo({ find: vi.fn(async () => live) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    const result = await gw.unarchiveSession(auth, sessionRuntimeRow, 'req_1')

    expect(result).toBe(live)
    expect(repo.find).toHaveBeenCalledWith('project_1', 'sess_1')
  })

  it('throws when repo.find returns null after unarchive', async () => {
    vi.mocked(unarchiveSessionRuntime).mockResolvedValueOnce(undefined as never)
    const repo = fakeRepo({ find: vi.fn(async () => null) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    await expect(gw.unarchiveSession(auth, sessionRuntimeRow, null)).rejects.toThrow(
      'Session row is required after a runtime operation',
    )
  })
})

// ── dispatchPrompt ────────────────────────────────────────────────────────────

describe('createSessionRuntimeGateway — dispatchPrompt', () => {
  it('returns ok with delivery and state on success', async () => {
    vi.mocked(dispatchSessionPrompt).mockResolvedValueOnce({
      ok: true,
      delivery: 'live',
      state: 'accepted',
    } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    const result = await gw.dispatchPrompt(auth, sessionRuntimeRow, 'hello')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.delivery).toBe('live')
      expect(result.state).toBe('accepted')
    }
  })

  it('returns error with status and message on failure', async () => {
    vi.mocked(dispatchSessionPrompt).mockResolvedValueOnce({
      ok: false,
      status: 409,
      message: 'Session is not accepting prompts',
    } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    const result = await gw.dispatchPrompt(auth, sessionRuntimeRow, 'hello')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toBe('Session is not accepting prompts')
    }
  })

  it('includes runtimeError in result when the dispatch outcome carries one', async () => {
    vi.mocked(dispatchSessionPrompt).mockResolvedValueOnce({
      ok: false,
      status: 500,
      message: 'Crash',
      runtimeError: { detail: 'stack overflow' },
    } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    const result = await gw.dispatchPrompt(auth, sessionRuntimeRow, 'hello')

    expect(result.ok).toBe(false)
    if (!result.ok && 'runtimeError' in result) {
      expect(result.runtimeError).toEqual({ detail: 'stack overflow' })
    }
  })

  it('omits runtimeError key when dispatch outcome has no runtimeError', async () => {
    vi.mocked(dispatchSessionPrompt).mockResolvedValueOnce({
      ok: false,
      status: 409,
      message: 'Busy',
    } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    const result = await gw.dispatchPrompt(auth, sessionRuntimeRow, 'hello')

    expect(result.ok).toBe(false)
    expect('runtimeError' in result).toBe(false)
  })
})

// ── decideApproval ────────────────────────────────────────────────────────────

describe('createSessionRuntimeGateway — decideApproval', () => {
  it('calls decideSessionApproval and returns the approval from repo on success', async () => {
    vi.mocked(decideSessionApproval).mockResolvedValueOnce({ ok: true, approval: { id: 'appr_1' } } as never)

    const approval = approvalRecord({ state: 'approved' })
    const repo = fakeRepo({ findApproval: vi.fn(async () => approval) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    const result = await gw.decideApproval(auth, sessionRuntimeRow, 'appr_1', {
      decision: 'approve',
      reason: 'looks good',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(approval)
    }
    expect(repo.findApproval).toHaveBeenCalledWith('project_1', 'sess_1', 'appr_1')
  })

  it('returns error when decideSessionApproval fails', async () => {
    const runtimeError = { status: 404, code: 'not_found', message: 'Approval not found' }
    vi.mocked(decideSessionApproval).mockResolvedValueOnce({ ok: false, error: runtimeError } as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    const result = await gw.decideApproval(auth, sessionRuntimeRow, 'appr_1', { decision: 'deny' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('not_found')
    }
  })

  it('throws when repo.findApproval returns null after a successful decision', async () => {
    vi.mocked(decideSessionApproval).mockResolvedValueOnce({ ok: true, approval: { id: 'appr_1' } } as never)
    const repo = fakeRepo({ findApproval: vi.fn(async () => null) })
    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), repo)

    await expect(gw.decideApproval(auth, sessionRuntimeRow, 'appr_1', { decision: 'approve' })).rejects.toThrow(
      'Decided approval row is required',
    )
  })
})

// ── markExpiredPending ────────────────────────────────────────────────────────

describe('createSessionRuntimeGateway — markExpiredPending', () => {
  it('delegates to markExpiredPendingSessions', async () => {
    vi.mocked(markExpiredPendingSessions).mockResolvedValueOnce(undefined as never)

    const gw = createSessionRuntimeGateway(fakeEnv(), fakeDb(), fakeRepo())
    await gw.markExpiredPending(auth)

    expect(markExpiredPendingSessions).toHaveBeenCalledOnce()
  })
})
