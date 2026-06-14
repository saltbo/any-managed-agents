import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'

// Characterization (golden-master) tests for the cloud-command / queue turn
// path: consumeCloudTurnMessage → executeCloudSessionTurn. The integration
// suite runs turns INLINE (AMA_RUNTIME_MODE=test ⇒ cloudTurnsRunInline), so the
// paused→enqueue continuation branch is unreachable there. These pin it (and
// the provider/model selection the Phase 1 TurnEngine unification must
// preserve) before that refactor moves the code.
const {
  runSessionTurnMock,
  enqueueCloudTurnMock,
  cloudTurnsRunInlineMock,
  recordAuditMock,
  findSessionMock,
  sessionEventStreamMock,
  updateSessionWhenStateMock,
} = vi.hoisted(() => ({
  runSessionTurnMock:
    vi.fn<(env: unknown, input: { provider: string; model: string | null }) => Promise<{ status: string }>>(),
  enqueueCloudTurnMock: vi.fn(),
  cloudTurnsRunInlineMock: vi.fn(() => false),
  recordAuditMock: vi.fn(),
  findSessionMock: vi.fn(),
  sessionEventStreamMock: vi.fn(() => [] as unknown[]),
  updateSessionWhenStateMock: vi.fn<
    (projectId: string, sessionId: string, expected: string | string[], fields: Record<string, unknown>) => boolean
  >(() => true),
}))

vi.mock('@cloudflare/sandbox', () => ({ getSandbox: vi.fn() }))

// Partial mock: keep the real error classes/guards (instanceof must work in the
// catch branches), stub only the turn loop.
vi.mock('./session-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session-runtime')>()),
  runSessionTurn: runSessionTurnMock,
}))

vi.mock('./turn-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./turn-queue')>()),
  enqueueCloudTurn: enqueueCloudTurnMock,
  cloudTurnsRunInline: cloudTurnsRunInlineMock,
}))

vi.mock('../audit', () => ({ recordAudit: recordAuditMock }))

vi.mock('../adapters/repos/runtime-orchestration', () => {
  const repo = {
    db: {},
    findSession: findSessionMock,
    sessionEventStream: sessionEventStreamMock,
    updateSessionWhenState: updateSessionWhenStateMock,
  }
  return {
    createRuntimeOrchestrationRepo: vi.fn(() => repo),
    createRuntimeOrchestrationRepoFromBinding: vi.fn(() => repo),
  }
})

import { consumeCloudTurnMessage } from './session-orchestration'
import { RuntimePolicyDeniedError } from './session-runtime'

const env = { DB: {}, AMA_RUNTIME_MODE: 'production' } as unknown as Env

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session_1',
    state: 'running',
    sandboxId: 'sandbox_1',
    modelProvider: 'workers-ai',
    modelConfig: JSON.stringify({}),
    agentSnapshot: JSON.stringify({ providerId: 'anthropic', model: '@cf/x' }),
    environmentSnapshot: null,
    metadata: null,
    ...overrides,
  }
}

const stepMessage = {
  type: 'session.step',
  sessionId: 'session_1',
  organizationId: 'org_1',
  projectId: 'proj_1',
  auditAction: 'session.command',
} as const

describe('consumeCloudTurnMessage — cloud-command turn path [spec: runtime/cloud-turn]', () => {
  beforeEach(() => {
    runSessionTurnMock.mockReset()
    enqueueCloudTurnMock.mockReset()
    recordAuditMock.mockReset()
    updateSessionWhenStateMock.mockClear()
    updateSessionWhenStateMock.mockReturnValue(true)
    sessionEventStreamMock.mockReturnValue([])
    findSessionMock.mockReset()
    findSessionMock.mockResolvedValue(fakeSession())
    cloudTurnsRunInlineMock.mockReturnValue(false)
  })

  it('re-enqueues a session.step continuation when the turn pauses, without parking idle', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'paused' })

    await consumeCloudTurnMessage(env, stepMessage)

    expect(enqueueCloudTurnMock).toHaveBeenCalledTimes(1)
    expect(enqueueCloudTurnMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        type: 'session.step',
        sessionId: 'session_1',
        organizationId: 'org_1',
        projectId: 'proj_1',
        auditAction: 'session.command',
      }),
    )
    // A paused turn never transitions the session to idle.
    for (const call of updateSessionWhenStateMock.mock.calls) {
      expect(call[3].state).not.toBe('idle')
    }
  })

  it('parks the session idle and does not enqueue when the turn completes', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnMessage(env, stepMessage)

    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle' }),
    )
  })

  it('passes session.modelProvider (over the agent snapshot provider) and the resolved model into the turn', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnMessage(env, stepMessage)

    expect(runSessionTurnMock).toHaveBeenCalledTimes(1)
    const input = runSessionTurnMock.mock.calls[0]?.[1]
    expect(input?.provider).toBe('workers-ai')
    expect(input?.model).toBe('@cf/x')
  })

  it('prefers modelConfig.model over the agent snapshot model', async () => {
    findSessionMock.mockResolvedValue(fakeSession({ modelConfig: JSON.stringify({ model: '@cf/override' }) }))
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnMessage(env, stepMessage)

    const input = runSessionTurnMock.mock.calls[0]?.[1]
    expect(input?.model).toBe('@cf/override')
  })

  it('parks the session idle with a policy-denied reason when the turn is policy-denied', async () => {
    runSessionTurnMock.mockRejectedValue(new RuntimePolicyDeniedError('blocked by sandbox policy'))

    await consumeCloudTurnMessage(env, stepMessage)

    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle', stateReason: 'policy-denied' }),
    )
  })
})
