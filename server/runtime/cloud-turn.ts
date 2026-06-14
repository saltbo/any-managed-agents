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
  type Repo,
  RUNTIME_START_TIMEOUT_MS,
  stringify,
  withRepo,
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
import {
  CONTINUATION_LIMIT_REASON,
  MAX_CONTINUATION_DEPTH,
  newTurnId,
  TURN_LEASE_RETRY_DELAY_SECONDS,
  turnLeaseExpiry,
} from './session-state'
import { buildSessionTurnCallbacks, loadRuntimeMessages, resolveSessionProviderModel } from './turn-driver'
import { type CloudTurnMessage, cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'

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
    const recorded = await createRuntimeOrchestrationRepo(db).updateSessionWhenState(
      auth.project.id,
      sessionId,
      'pending',
      started,
    )
    if (!recorded) {
      // The row left 'pending' between the re-read and this CAS (concurrent stop
      // or a duplicate session.start). The just-provisioned sandbox is recorded
      // on no row, so tear it down here — let a teardown error reach the catch.
      await stopCloudSessionRuntime(env, sandboxId)
      return
    }
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
  | { ok: true; requiresAction?: boolean; paused?: boolean }
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
  const repo = withRepo(db)
  let callbacks: ReturnType<typeof buildSessionTurnCallbacks> | null = null
  try {
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required')
    }
    const modelConfig = parseJson<Record<string, unknown>>(session.modelConfig) ?? {}
    const messages = await loadRuntimeMessages(repo, session.id)
    const { provider: turnProvider, model: turnModel } = resolveSessionProviderModel(
      session,
      agentSnapshot,
      modelConfig,
    )
    callbacks = buildSessionTurnCallbacks({
      repo,
      auth,
      session,
      recordPolicyDenial: async (blocked) => {
        const operationFields =
          blocked.operation.operation === 'command'
            ? { command: blocked.operation.command }
            : { host: blocked.operation.host }
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
      },
    })
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
      ensureActive: callbacks.ensureActive,
      onEvent: callbacks.onEvent,
      resolveToolResult: callbacks.resolveToolResult,
      approveToolCall: callbacks.approveToolCall,
    })
    if (result.status === 'idle') {
      await repo.updateSessionWhenState(auth.project.id, session.id, 'running', {
        state: 'idle',
        updatedAt: now(),
      })
    }

    if (result.status === 'paused') {
      await repo.updateSessionWhenState(auth.project.id, session.id, 'running', {
        updatedAt: now(),
      })
      // The queue consumer owns the continuation (lease renewal + step cap), so a
      // paused turn just reports it instead of enqueuing the next step itself.
      return { ok: true, paused: true }
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
      if (callbacks?.approvalGate.requiresAction()) {
        return { ok: true, requiresAction: true }
      }
      return { ok: false, cancelled: true }
    }
    const safeError = safeRuntimeError(error)
    if (callbacks?.wasPolicyDenied() || isRuntimePolicyDenied(error)) {
      await repo.updateSessionWhenState(auth.project.id, session.id, 'running', {
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

// Maps a completed turn's outcome to the continuation decision under the lease we
// hold (turnId). A paused turn extends the chain — bumping the depth, enforcing
// the cap, renewing the lease, and enqueuing the next step. Any terminal outcome
// releases the lease so the next queued turn can claim it.
async function handleTurnOutcome(
  env: Env,
  repo: Repo,
  auth: AuthScope,
  session: SessionRow,
  turnId: string,
  auditAction: 'session.initial_prompt' | 'session.command',
  outcome: CloudTurnOutcome,
): Promise<void> {
  if (outcome.ok && outcome.paused) {
    const depth = await repo.incrementContinuationDepth(auth.project.id, session.id, turnId)
    if (depth >= MAX_CONTINUATION_DEPTH) {
      await repo.releaseTurnLease(auth.project.id, session.id, turnId, {
        state: 'idle',
        stateReason: CONTINUATION_LIMIT_REASON,
        updatedAt: now(),
      })
      return
    }
    await repo.renewTurnLease(auth.project.id, session.id, turnId, turnLeaseExpiry())
    await enqueueCloudTurn(env, {
      type: 'session.step',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      turnId,
      auditAction,
    })
    return
  }
  // Terminal (idle / error / cancelled / requires-action): executeCloudSessionTurn
  // already set the session state; just clear the lease for the next turn.
  await repo.releaseTurnLease(auth.project.id, session.id, turnId, {})
}

// Runs a fresh turn under a newly-acquired lease. If the lease is held by another
// in-flight turn the message is deferred (re-enqueued after a short delay) instead
// of racing it — this is the per-session serialization (H1).
async function runLeasedTurn(
  env: Env,
  db: Db,
  repo: Repo,
  auth: AuthScope,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.initial_prompt' | 'session.command',
  deferMessage: CloudTurnMessage,
): Promise<void> {
  const turnId = newTurnId()
  const acquiredAt = now()
  const acquired = await repo.acquireTurnLease(
    auth.project.id,
    session.id,
    turnId,
    turnLeaseExpiry(acquiredAt),
    acquiredAt,
  )
  if (!acquired) {
    await enqueueCloudTurn(env, deferMessage, { delaySeconds: TURN_LEASE_RETRY_DELAY_SECONDS })
    return
  }
  const outcome = await executeCloudSessionTurn(env, db, auth, session, work, auditAction)
  await handleTurnOutcome(env, repo, auth, session, turnId, auditAction, outcome)
}

export async function consumeCloudTurnMessage(env: Env, message: CloudTurnMessage): Promise<void> {
  const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)
  const db = repo.db
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
    if (message.turnId) {
      // Budget continuation of an in-flight chain: renew the SAME lease so a
      // concurrent prompt that arrived mid-chain stays deferred. If the lease was
      // lost (cleared, or reclaimed after expiry by another worker) — stop.
      const renewed = await repo.renewTurnLease(auth.project.id, session.id, message.turnId, turnLeaseExpiry())
      if (!renewed) {
        return
      }
      const outcome = await executeCloudSessionTurn(env, db, auth, session, { continuation: true }, message.auditAction)
      await handleTurnOutcome(env, repo, auth, session, message.turnId, message.auditAction, outcome)
      return
    }
    // Approval-resume (continuation with no held lease): acquire a fresh lease.
    await runLeasedTurn(env, db, repo, auth, session, { continuation: true }, message.auditAction, message)
    return
  }
  if (session.state === 'idle') {
    const reclaimed = await repo.updateSessionWhenState(auth.project.id, session.id, 'idle', {
      state: 'running',
      stateReason: null,
      updatedAt: now(),
    })
    if (!reclaimed) {
      return
    }
  } else if (session.state !== 'running') {
    return
  }
  await runLeasedTurn(env, db, repo, auth, session, { prompt: message.prompt }, message.auditAction, message)
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

// A cloud turn message that exhausted its retries lands in the dead-letter queue.
// Mark the stranded session errored (clearing any lease it held) so clients
// recover it immediately instead of waiting for the 20-minute stall sweep.
export async function markCloudTurnDeadLettered(env: Env, message: CloudTurnMessage): Promise<void> {
  const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)
  const auth = cloudTurnSystemAuth(message)
  await repo.updateSessionWhenState(auth.project.id, message.sessionId, ['pending', 'running'], {
    state: 'error',
    stateReason: 'cloud-turn-failed',
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    updatedAt: now(),
  })
  await recordAudit(repo.db, {
    auth,
    action: message.type === 'session.start' ? 'session.runtime.start' : 'session.command',
    resourceType: 'session',
    resourceId: message.sessionId,
    outcome: 'failure',
    sessionId: message.sessionId,
    metadata: { reason: 'cloud_turn_dead_lettered', messageType: message.type },
  })
}
