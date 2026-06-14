import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'

// Robustness tests for startup partial-failure (H5):
//  - FIX 1: startSessionRuntimeForRow must not leak a provisioned sandbox when
//    the pending→idle CAS no-ops (lost-row race).
//  - FIX 2: createSessionForAgent must reconcile the orphaned pending row to
//    'error' when the launch dispatch (e.g. the queue send) throws.
const {
  startSessionRuntimeMock,
  stopSessionRuntimeMock,
  resolveMcpSnapshotMock,
  resolveRuntimeSecretEnvMock,
  recordAuditMock,
  findSessionMock,
  updateSessionWhenStateMock,
} = vi.hoisted(() => ({
  startSessionRuntimeMock: vi.fn(),
  stopSessionRuntimeMock: vi.fn(async () => undefined),
  resolveMcpSnapshotMock: vi.fn(async () => ({ connectors: [] })),
  resolveRuntimeSecretEnvMock: vi.fn(async () => ({})),
  recordAuditMock: vi.fn(),
  findSessionMock: vi.fn(),
  updateSessionWhenStateMock: vi.fn<
    (projectId: string, sessionId: string, expected: string | string[], fields: Record<string, unknown>) => boolean
  >(() => true),
}))

vi.mock('@cloudflare/sandbox', () => ({ getSandbox: vi.fn() }))

// Keep the real error classes/guards; stub the startup + teardown seam so no
// real sandbox is provisioned. drivers.ts binds AMA_DRIVER.startCloudSession to
// this module's startSessionRuntime, so the mock flows through the driver.
vi.mock('./session-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session-runtime')>()),
  startSessionRuntime: startSessionRuntimeMock,
  stopSessionRuntime: stopSessionRuntimeMock,
}))

vi.mock('./session-provisioning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session-provisioning')>()),
  resolveMcpSnapshot: resolveMcpSnapshotMock,
}))

vi.mock('./secret-env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./secret-env')>()),
  resolveRuntimeSecretEnv: resolveRuntimeSecretEnvMock,
}))

vi.mock('../audit', () => ({ recordAudit: recordAuditMock }))

// markInitialPromptFailed now records through the AuditPort (deps.audit); the
// shim builds it via createAuditPort. Stub the gateway so the failure audit goes
// to the same spy the legacy recordAudit path used (record(auth, entry) → the
// entry lands in call[1], matching the recordAudit(db, { auth, ...entry }) shape
// the assertions filter on).
vi.mock('../adapters/gateways/audit', () => ({
  createAuditPort: vi.fn(() => ({ record: (auth: unknown, entry: unknown) => recordAuditMock(auth, entry) })),
}))

vi.mock('../adapters/repos/runtime-orchestration', () => {
  const repo = {
    db: {},
    findSession: findSessionMock,
    updateSessionWhenState: updateSessionWhenStateMock,
  }
  return {
    createRuntimeOrchestrationRepo: vi.fn(() => repo),
    createRuntimeOrchestrationRepoFromBinding: vi.fn(() => repo),
  }
})

import { startSessionRuntimeForRow } from './cloud-turn'

const env = { DB: {}, AMA_RUNTIME_MODE: 'test' } as unknown as Env

const auth: AuthScope = {
  user: { id: 'user_1' },
  organization: { id: 'org_1', name: 'org_1' },
  project: { id: 'proj_1', name: 'proj_1' },
  roles: ['system'],
  permissions: ['*'],
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session_1',
    state: 'pending',
    sandboxId: 'sandbox_1',
    metadata: null,
    ...overrides,
  }
}

const agentSnapshot = { providerId: 'anthropic', model: '@cf/x' } as never

describe('startSessionRuntimeForRow — startup partial-failure (H5 FIX 1)', () => {
  beforeEach(() => {
    startSessionRuntimeMock.mockReset()
    startSessionRuntimeMock.mockResolvedValue({
      sandboxId: 'sandbox_1',
      runtimeEndpointPath: '/runtime/session_1',
      metadata: { runtimeMode: 'test' },
    })
    stopSessionRuntimeMock.mockReset()
    stopSessionRuntimeMock.mockResolvedValue(undefined)
    resolveMcpSnapshotMock.mockReset()
    resolveMcpSnapshotMock.mockResolvedValue({ connectors: [] })
    resolveRuntimeSecretEnvMock.mockReset()
    resolveRuntimeSecretEnvMock.mockResolvedValue({})
    recordAuditMock.mockReset()
    findSessionMock.mockReset()
    findSessionMock.mockResolvedValue(pendingRow())
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
  })

  it('tears down the provisioned sandbox and skips audit/initial-prompt when the pending→idle CAS no-ops', async () => {
    // Sandbox provisioned, row still reads 'pending' on the re-read, but the CAS
    // loses the row (concurrent stop / duplicate session.start redelivery).
    updateSessionWhenStateMock.mockReturnValueOnce(false)

    await startSessionRuntimeForRow(env, {} as never, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'ama',
      runtimeConfig: {},
      resourceRefs: [],
      env: {},
      secretEnv: [],
      initialPrompt: 'hello',
    })

    // The just-provisioned sandbox is torn down exactly once.
    expect(startSessionRuntimeMock).toHaveBeenCalledTimes(1)
    expect(stopSessionRuntimeMock).toHaveBeenCalledTimes(1)
    expect(stopSessionRuntimeMock).toHaveBeenCalledWith(env, 'sandbox_1')
    // No success audit and no initial-prompt dispatch (no second CAS) ran.
    const successAudits = recordAuditMock.mock.calls.filter(
      (call) => (call[1] as { outcome?: string }).outcome === 'success',
    )
    expect(successAudits).toHaveLength(0)
    expect(updateSessionWhenStateMock).toHaveBeenCalledTimes(1)
  })

  it('records the success audit and dispatches the initial prompt when the CAS succeeds', async () => {
    updateSessionWhenStateMock.mockReturnValue(true)

    await startSessionRuntimeForRow(env, {} as never, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'ama',
      runtimeConfig: {},
      resourceRefs: [],
      env: {},
      secretEnv: [],
      initialPrompt: 'hello',
    })

    // No teardown on the happy path.
    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
    const successAudits = recordAuditMock.mock.calls.filter(
      (call) => (call[1] as { outcome?: string }).outcome === 'success',
    )
    expect(successAudits.length).toBeGreaterThanOrEqual(1)
    // The initial-prompt dispatch performs a second updateSessionWhenState CAS.
    expect(updateSessionWhenStateMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
