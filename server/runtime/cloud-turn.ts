// Cloud turn execution, runtime startup, and the queue consumer.
//
// This cluster owns the cloud-side model turn loop: launching the cloud
// runtime for a pending session row (startSessionRuntimeForRow), running a
// single model turn with the approval/policy gate (executeCloudSessionTurn),
// the queue consumer that dispatches start/step/turn messages
// (consumeCloudTurnMessage), and the initial-prompt dispatch that seeds the
// first turn after startup (dispatchInitialPrompt).
//
// It imports from session-base + the runtime leaf modules; the higher clusters
// (create, prompt, approval) import from here.

import {
  createRuntimeOrchestrationRepo,
  createRuntimeOrchestrationRepoFromBinding,
  type SessionRow,
} from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import type { RuntimeName } from '../contracts/environment-contracts'
import type { Env } from '../env'
import { policyBlocksSandboxOperation } from '../policy'
import type { AuthScope } from '../usecases/ports'
import { runtimeDriver, runtimeDriverName } from './drivers'
import { safeRuntimeError } from './runtime-error'
import { type RuntimeSecretEnvEntry, resolveRuntimeSecretEnv } from './secret-env'
import {
  appendRuntimeEvent,
  cloudTurnSystemAuth,
  type Db,
  findSession,
  markInitialPromptFailed,
  now,
  RUNTIME_START_TIMEOUT_MS,
  stringify,
  withTimeout,
} from './session-base'
import { mcpConnectorIds, resolveMcpSnapshot } from './session-provisioning'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  runSessionTurn,
  stopSessionRuntime as stopCloudSessionRuntime,
} from './session-runtime'
import {
  type NormalizedEnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
  type ResourceRef,
  type SerializedAgentVersion,
} from './session-snapshot'
import { createToolApprovalGate } from './tool-approvals'
import { type CloudTurnMessage, cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'
import { assertRuntimeSessionRunning, loadRuntimeMessages, resolveSessionProviderModel } from './turn-runner'

// Per-invocation soft budget for new model turns (see executeCloudSessionTurn).
const CLOUD_TURN_SOFT_BUDGET_MS = 4 * 60_000

export async function startSessionRuntimeForRow(
  env: Env,
  db: Db,
  auth: AuthScope,
  input: {
    pending: SessionRow
    agentSnapshot: SerializedAgentVersion
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs: ResourceRef[]
    env?: Record<string, string>
    secretEnv?: RuntimeSecretEnvEntry[]
    initialPrompt?: string
  },
) {
  const { pending, agentSnapshot, environmentSnapshot, runtime, runtimeConfig, resourceRefs, initialPrompt } = input
  const sessionEnv = input.env
  const sessionSecretEnv = input.secretEnv ?? []
  const sessionId = pending.id
  const sandboxId = pending.sandboxId ?? sessionId.toLowerCase()
  const runtimeName = runtime
  const driver = runtimeDriver(runtimeName)
  if (!driver.startCloudSession) {
    throw new Error(`Runtime ${runtimeName} does not support cloud session startup`)
  }
  try {
    const mcpSnapshot = await resolveMcpSnapshot(db, auth, sessionId, agentSnapshot, environmentSnapshot)
    const runtimeEnvironmentSnapshot = environmentSnapshot ? { ...environmentSnapshot, runtimeConfig } : null
    const resolvedSecretEnv = await resolveRuntimeSecretEnv(
      env,
      db,
      { organizationId: auth.organization.id, projectId: auth.project.id },
      sessionSecretEnv,
    )
    const startedRuntime = await withTimeout(
      driver.startCloudSession(env, {
        sessionId,
        sandboxId,
        runtime: runtimeName,
        provider: agentSnapshot.providerId,
        model: agentSnapshot.model,
        agentSnapshot,
        environmentSnapshot: runtimeEnvironmentSnapshot,
        mcpSnapshot,
        resourceRefs,
        runtimeEnv: sessionEnv ?? {},
        runtimeSecretEnv: sessionSecretEnv,
        resolvedSecretEnv,
      }),
      RUNTIME_START_TIMEOUT_MS,
      'Session runtime startup timed out',
    )
    const current = await findSession(db, auth, sessionId)
    if (current?.state !== 'pending') {
      if (current?.state !== 'idle') {
        await stopCloudSessionRuntime(env, sandboxId).catch(() => undefined)
      }
      return
    }
    const startedAt = now()
    const existingMetadata = parseJson<Record<string, unknown>>(pending.metadata) ?? {}
    const metadata = {
      ...existingMetadata,
      ...startedRuntime.metadata,
      runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
      runtimeBackend: driver.cloudBackend,
      runtimeProtocol: driver.cloudProtocol,
      mcpConnectors: mcpConnectorIds(mcpSnapshot),
    }
    const started = {
      sandboxId,
      piRuntimeId: null,
      piProcessId: null,
      runtimeEndpointPath: startedRuntime.runtimeEndpointPath,
      state: 'idle',
      metadata: stringify(metadata),
      startedAt,
      updatedAt: startedAt,
    }
    await createRuntimeOrchestrationRepo(db).updateSessionWhenState(auth.project.id, sessionId, 'pending', started)
    await recordAudit(db, {
      auth,
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'success',
      sessionId,
      metadata: { sandboxId: startedRuntime.sandboxId, runtimeEndpointPath: startedRuntime.runtimeEndpointPath },
    })
    if (initialPrompt) {
      await dispatchInitialPrompt(
        env,
        db,
        auth,
        { ...pending, ...started, stateReason: null, stoppedAt: null, archivedAt: null },
        initialPrompt,
      )
    }
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    const failed = {
      state: 'error',
      stateReason: safeError.message,
      metadata: stringify({
        ...(parseJson<Record<string, unknown>>(pending.metadata) ?? {}),
        runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
        runtimeBackend: driver.cloudBackend,
        error: safeError,
      }),
      updatedAt: failedAt,
    }
    await createRuntimeOrchestrationRepo(db).updateSessionWhenState(auth.project.id, sessionId, 'pending', failed)
    await recordAudit(db, {
      auth,
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'failure',
      sessionId,
      metadata: { ...safeError },
    })
    await stopCloudSessionRuntime(env, sandboxId).catch(() => undefined)
  }
}

// ── Cloud turn execution + queue consumer ───────────────────────────────────

export type CloudTurnOutcome =
  | { ok: true; requiresAction?: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ReturnType<typeof safeRuntimeError> }

export async function executeCloudSessionTurn(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.initial_prompt' | 'session.command',
): Promise<CloudTurnOutcome> {
  let approvalGateRef: ReturnType<typeof createToolApprovalGate> | null = null
  let policyDeniedToolCall = false
  try {
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required')
    }
    const modelConfig = parseJson<Record<string, unknown>>(session.modelConfig) ?? {}
    const repo = createRuntimeOrchestrationRepo(db)
    const messages = await loadRuntimeMessages(repo, session.id)
    const { provider: turnProvider, model: turnModel } = resolveSessionProviderModel(
      session,
      agentSnapshot,
      modelConfig,
    )
    const ensureActive = async () => {
      await assertRuntimeSessionRunning(repo, auth.project.id, session.id)
    }
    const sessionMetadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    const approvalGate = createToolApprovalGate({
      db,
      auth,
      sessionId: session.id,
      sessionMetadata,
      appendEvent: (event, metadata) => appendRuntimeEvent(repo, { auth, sessionId: session.id, event, metadata }),
    })
    approvalGateRef = approvalGate
    const startedAt = Date.now()
    const result = await runSessionTurn(env, {
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      provider: turnProvider,
      model: turnModel,
      agentSnapshot,
      ...(work.prompt !== undefined ? { prompt: work.prompt } : {}),
      ...(work.continuation ? { continuation: true } : {}),
      messages,
      ...(cloudTurnsRunInline(env) ? {} : { shouldPause: () => Date.now() - startedAt > CLOUD_TURN_SOFT_BUDGET_MS }),
      ensureActive,
      onEvent: async (event, metadata) => {
        if (approvalGate.shouldSuppressEvent(event)) {
          return
        }
        await ensureActive()
        await appendRuntimeEvent(repo, { auth, sessionId: session.id, event, ...(metadata ? { metadata } : {}) })
      },
      resolveToolResult: (input) => approvalGate.resolveToolResult(input),
      approveToolCall: async ({ toolCallId, toolName, input }) => {
        await ensureActive()
        const blocked = await policyBlocksSandboxOperation(db, auth, {
          session: {
            id: session.id,
            agentSnapshot: session.agentSnapshot,
            environmentSnapshot: session.environmentSnapshot,
          },
          toolName,
          input,
        })
        if (blocked) {
          const operationFields =
            blocked.operation.operation === 'command'
              ? { command: blocked.operation.command }
              : { host: blocked.operation.host }
          await ensureActive()
          await appendRuntimeEvent(repo, {
            auth,
            sessionId: session.id,
            event: {
              type: 'policy_denied',
              category: blocked.decision.category,
              ruleId: blocked.decision.rule,
              resourceType: blocked.operation.resourceType,
              resourceId: blocked.operation.resourceId,
              decision: blocked.decision,
              operation: blocked.operation.operation,
              ...operationFields,
            },
            metadata: { source: 'policy' },
          })
          await recordAudit(db, {
            auth,
            action: 'runtime_sandbox.operation',
            resourceType: blocked.operation.resourceType,
            resourceId: blocked.operation.resourceId,
            outcome: 'denied',
            sessionId: session.id,
            policyCategory: blocked.decision.category,
            metadata: { operation: blocked.operation.operation, ...operationFields, decision: blocked.decision },
          })
          await ensureActive()
          policyDeniedToolCall = true
          return { allowed: false, reason: blocked.decision.message }
        }
        const approvalDecision = await approvalGate.gate({ toolCallId, toolName, input })
        if (approvalDecision) {
          return approvalDecision
        }
        return { allowed: true }
      },
    })
    if (result.status === 'idle') {
      await createRuntimeOrchestrationRepo(db).updateSessionWhenState(auth.project.id, session.id, 'running', {
        state: 'idle',
        updatedAt: now(),
      })
    }

    if (result.status === 'paused') {
      await createRuntimeOrchestrationRepo(db).updateSessionWhenState(auth.project.id, session.id, 'running', {
        updatedAt: now(),
      })
      await enqueueCloudTurn(env, {
        type: 'session.step',
        sessionId: session.id,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        auditAction,
      })
      return { ok: true }
    }

    await recordAudit(db, {
      auth,
      action: auditAction,
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'success',
      sessionId: session.id,
      metadata:
        auditAction === 'session.initial_prompt' ? { source: 'api', promptDispatched: true } : { type: 'prompt' },
    })
    return { ok: true }
  } catch (error) {
    if (isRuntimeTurnCancelled(error)) {
      if (approvalGateRef?.requiresAction()) {
        return { ok: true, requiresAction: true }
      }
      return { ok: false, cancelled: true }
    }
    const safeError = safeRuntimeError(error)
    if (policyDeniedToolCall || isRuntimePolicyDenied(error)) {
      await createRuntimeOrchestrationRepo(db).updateSessionWhenState(auth.project.id, session.id, 'running', {
        state: 'idle',
        stateReason: 'policy-denied',
        updatedAt: now(),
      })
      return { ok: false, cancelled: false, error: safeError }
    }
    await markInitialPromptFailed(db, auth, session, safeError.message)
    return { ok: false, cancelled: false, error: safeError }
  }
}

export async function consumeCloudTurnMessage(env: Env, message: CloudTurnMessage): Promise<void> {
  const db = createRuntimeOrchestrationRepoFromBinding(env.DB).db
  const auth = cloudTurnSystemAuth(message)
  const session = await findSession(db, auth, message.sessionId)
  if (!session) {
    return
  }
  if (message.type === 'session.start') {
    if (session.state !== 'pending') {
      return
    }
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required for cloud startup')
    }
    await startSessionRuntimeForRow(env, db, auth, {
      pending: session,
      agentSnapshot,
      environmentSnapshot: parseJson<NormalizedEnvironmentSnapshot>(session.environmentSnapshot),
      runtime: message.runtime as RuntimeName,
      runtimeConfig: message.runtimeConfig,
      resourceRefs: message.resourceRefs,
      env: message.runtimeEnv,
      secretEnv: message.runtimeSecretEnv,
      ...(message.initialPrompt !== undefined ? { initialPrompt: message.initialPrompt } : {}),
    })
    return
  }
  if (message.type === 'session.step') {
    if (session.state !== 'running') {
      return
    }
    await executeCloudSessionTurn(env, db, auth, session, { continuation: true }, message.auditAction)
    return
  }
  if (session.state === 'idle') {
    const reclaimed = await createRuntimeOrchestrationRepo(db).updateSessionWhenState(
      auth.project.id,
      session.id,
      'idle',
      { state: 'running', stateReason: null, updatedAt: now() },
    )
    if (!reclaimed) {
      return
    }
  } else if (session.state !== 'running') {
    return
  }
  await executeCloudSessionTurn(env, db, auth, session, { prompt: message.prompt }, message.auditAction)
}

export async function dispatchInitialPrompt(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  initialPrompt: string,
) {
  const submittedAt = now()
  const started = await createRuntimeOrchestrationRepo(db).updateSessionWhenState(
    auth.project.id,
    session.id,
    ['idle', 'running'],
    { state: 'running', stateReason: null, updatedAt: submittedAt },
  )
  if (!started) {
    throw new Error('Session runtime is no longer active')
  }

  if (cloudTurnsRunInline(env)) {
    await executeCloudSessionTurn(env, db, auth, session, { prompt: initialPrompt }, 'session.initial_prompt')
    return
  }
  await enqueueCloudTurn(env, {
    type: 'session.turn',
    sessionId: session.id,
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    prompt: initialPrompt,
    auditAction: 'session.initial_prompt',
  })
}
