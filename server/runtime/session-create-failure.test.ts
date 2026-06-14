import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'

// Robustness test for startup partial-failure (H5 FIX 2): when the launch
// dispatch throws after the pending row is persisted (e.g. the cloud-turn queue
// send fails), createSessionForAgent must reconcile the orphaned row to 'error'
// and report a session_launch_failed failure instead of stranding it 'pending'.
const {
  enqueueCloudTurnMock,
  cloudTurnsRunInlineMock,
  startSessionRuntimeForRowMock,
  recordAuditMock,
  evaluateProviderPolicyForSessionMock,
  evaluateSandboxRuntimePolicyMock,
  resolveSessionProviderIdMock,
  validateRuntimeProviderModelMock,
  resolveSessionProviderConfigMock,
  providerRuntimeEnvMock,
  serializeAgentVersionMock,
  serializeEnvironmentVersionMock,
  insertSessionMock,
  updateSessionWhenStateMock,
  findAgentMock,
  findAgentVersionMock,
  findEnvironmentMock,
  findEnvironmentVersionMock,
} = vi.hoisted(() => ({
  enqueueCloudTurnMock: vi.fn(),
  cloudTurnsRunInlineMock: vi.fn(() => false),
  startSessionRuntimeForRowMock: vi.fn(),
  recordAuditMock: vi.fn(),
  evaluateProviderPolicyForSessionMock: vi.fn(async () => ({ decision: { allowed: true }, override: null })),
  evaluateSandboxRuntimePolicyMock: vi.fn(async () => ({ allowed: true })),
  resolveSessionProviderIdMock: vi.fn(async () => 'anthropic'),
  validateRuntimeProviderModelMock: vi.fn(async () => true),
  resolveSessionProviderConfigMock: vi.fn(async () => ({ ok: true, config: null })),
  providerRuntimeEnvMock: vi.fn(() => ({ env: {}, secretEnv: [] })),
  serializeAgentVersionMock: vi.fn(() => ({ id: 'agentver_1', providerId: 'anthropic', model: '@cf/x' })),
  serializeEnvironmentVersionMock: vi.fn(() => ({ id: 'envver_1', hostingMode: 'cloud', runtimeConfig: {} })),
  insertSessionMock: vi.fn(async () => undefined),
  updateSessionWhenStateMock: vi.fn<
    (projectId: string, sessionId: string, expected: string | string[], fields: Record<string, unknown>) => boolean
  >(() => true),
  findAgentMock: vi.fn(),
  findAgentVersionMock: vi.fn(),
  findEnvironmentMock: vi.fn(),
  findEnvironmentVersionMock: vi.fn(),
}))

vi.mock('@cloudflare/sandbox', () => ({ getSandbox: vi.fn() }))

vi.mock('./turn-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./turn-queue')>()),
  enqueueCloudTurn: enqueueCloudTurnMock,
  cloudTurnsRunInline: cloudTurnsRunInlineMock,
}))

// createSessionForAgent now delegates to the deps-first usecase; the shim builds
// CreateSessionDeps via cloudTurnDeps (kept real) and the usecase reaches the
// inline launch through the usecase cloud-turn module. Stub that seam so no real
// startup runs; the queued path (cloudTurnsRunInline=false) never invokes it.
vi.mock('./cloud-turn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cloud-turn')>()),
}))

vi.mock('../usecases/runtime/cloud-turn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../usecases/runtime/cloud-turn')>()),
  startSessionRuntimeForRow: startSessionRuntimeForRowMock,
}))

vi.mock('../audit', () => ({ recordAudit: recordAuditMock }))

vi.mock('../policy', () => ({
  evaluateProviderPolicyForSession: evaluateProviderPolicyForSessionMock,
  evaluateSandboxRuntimePolicy: evaluateSandboxRuntimePolicyMock,
}))

// Provider/runtime resolution + provider-config read now live in the deps-first
// provisioning usecase; providerRuntimeEnv is a pure domain rule. Mock those seams.
vi.mock('../usecases/runtime/provisioning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../usecases/runtime/provisioning')>()),
  resolveSessionProviderId: resolveSessionProviderIdMock,
  validateRuntimeProviderModel: validateRuntimeProviderModelMock,
  resolveSessionProviderConfig: resolveSessionProviderConfigMock,
}))

vi.mock('../domain/runtime/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/runtime/provider')>()),
  providerRuntimeEnv: providerRuntimeEnvMock,
}))

vi.mock('./session-snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session-snapshot')>()),
  serializeAgentVersion: serializeAgentVersionMock,
  serializeEnvironmentVersion: serializeEnvironmentVersionMock,
}))

vi.mock('../adapters/repos/runtime-orchestration', () => {
  const repo = {
    db: {},
    findAgent: findAgentMock,
    findAgentVersion: findAgentVersionMock,
    findEnvironment: findEnvironmentMock,
    findEnvironmentVersion: findEnvironmentVersionMock,
    insertSession: insertSessionMock,
    updateSessionWhenState: updateSessionWhenStateMock,
  }
  return {
    createRuntimeOrchestrationRepo: vi.fn(() => repo),
    createRuntimeOrchestrationRepoFromBinding: vi.fn(() => repo),
  }
})

import { createSessionForAgent } from './session-create'

const env = { DB: {}, AMA_RUNTIME_MODE: 'production' } as unknown as Env

const auth: AuthScope = {
  user: { id: 'user_1' },
  organization: { id: 'org_1', name: 'org_1' },
  project: { id: 'proj_1', name: 'proj_1' },
  roles: ['system'],
  permissions: ['*'],
}

describe('createSessionForAgent — launch dispatch failure (H5 FIX 2)', () => {
  beforeEach(() => {
    enqueueCloudTurnMock.mockReset()
    cloudTurnsRunInlineMock.mockReturnValue(false)
    recordAuditMock.mockReset()
    insertSessionMock.mockReset()
    insertSessionMock.mockResolvedValue(undefined)
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    findAgentMock.mockResolvedValue({
      id: 'agent_1',
      currentVersionId: 'agentver_1',
      archivedAt: null,
      memoryPolicy: null,
    })
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: '@cf/x', providerId: 'anthropic' })
    findEnvironmentMock.mockResolvedValue({ id: 'env_1', currentVersionId: 'envver_1' })
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'cloud' })
  })

  it('reconciles the orphaned pending row to error and returns session_launch_failed when the cloud-turn enqueue throws', async () => {
    enqueueCloudTurnMock.mockRejectedValue(new Error('queue send failed'))

    const result = await createSessionForAgent(env, {} as never, auth, 'agent_1', 'env_1', { runtime: 'ama' }, null)

    expect(result).toEqual({
      ok: false,
      error: { status: 500, code: 'session_launch_failed', message: 'queue send failed' },
    })
    // The pending row was inserted, then reconciled to 'error' under the
    // pending CAS.
    expect(insertSessionMock).toHaveBeenCalledTimes(1)
    const reconcile = updateSessionWhenStateMock.mock.calls.find(
      (call) => call[2] === 'pending' && (call[3] as { state?: string }).state === 'error',
    )
    expect(reconcile).toBeTruthy()
    expect((reconcile?.[3] as { stateReason?: string }).stateReason).toBe('queue send failed')
    // A create-failure audit was recorded.
    const failureAudit = recordAuditMock.mock.calls.find(
      (call) =>
        (call[1] as { action?: string; outcome?: string }).action === 'session.create' &&
        (call[1] as { outcome?: string }).outcome === 'failure',
    )
    expect(failureAudit).toBeTruthy()
  })

  it('keeps the happy path: returns ok and does not reconcile when the enqueue succeeds', async () => {
    enqueueCloudTurnMock.mockResolvedValue(undefined)

    const result = await createSessionForAgent(env, {} as never, auth, 'agent_1', 'env_1', { runtime: 'ama' }, null)

    expect(result.ok).toBe(true)
    expect(enqueueCloudTurnMock).toHaveBeenCalledTimes(1)
    const reconcile = updateSessionWhenStateMock.mock.calls.find(
      (call) => (call[3] as { state?: string }).state === 'error',
    )
    expect(reconcile).toBeUndefined()
  })
})
