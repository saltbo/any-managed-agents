// The single in-Worker turn driver. Both cloud-side turn entrypoints — the
// CLOUD_TURNS queue path (cloud-turn.executeCloudSessionTurn) and the
// runtime-endpoint proxy (recordRuntimeMessageOutcome) — drive the same
// runtime-core engine via runSessionTurn over the SAME callback bundle:
// the suppress→ensureActive→append event sink, the approval-gate tool-result
// resolver, and the policy+gate approveToolCall with its denial recording.
//
// buildSessionTurnCallbacks is that bundle; the two callers differ only in how
// they record a policy denial (cloud inlines event+audit; the proxy uses the
// shared denyRuntimePolicy helper) and in how they map the turn outcome, so the
// denial recorder is injected and the outcome handling stays with each caller.
import type { RuntimeOrchestrationRepo, SessionRow } from '../adapters/repos/runtime-orchestration'
import type { Env } from '../env'
import { policyBlocksSandboxOperation } from '../policy'
import type { AuthScope } from '../usecases/ports'
import { safeRuntimeError } from './runtime-error'
import { denyRuntimePolicy, runtimeRequestHasTestOnlyFields } from './runtime-proxy-policy'
import { appendRuntimeEvent, type Repo } from './session-base'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  RuntimePolicyDeniedError,
  type RuntimeToolPolicyDecision,
  type RuntimeToolPolicyInput,
  RuntimeTurnCancelledError,
  runSessionTurn,
  runtimeMessagesFromEvents,
} from './session-runtime'
import { parseJson } from './session-snapshot'
import { createToolApprovalGate } from './tool-approvals'

// ── Shared turn setup (single-sourced so the two paths can't drift) ───────────

export async function loadRuntimeMessages(repo: RuntimeOrchestrationRepo, sessionId: string) {
  return runtimeMessagesFromEvents(await repo.sessionEventStream(sessionId))
}

export async function assertRuntimeSessionRunning(
  repo: RuntimeOrchestrationRepo,
  projectId: string,
  sessionId: string,
) {
  const active = await repo.sessionState(projectId, sessionId)
  if (active?.state !== 'running') {
    throw new RuntimeTurnCancelledError()
  }
}

// Single source for the session's runtime provider + model. The session's pinned
// modelProvider wins; otherwise the agent snapshot's providerId (falling back to
// the platform default). The model prefers the session modelConfig, then the
// agent snapshot, else null (the engine resolves the provider default).
export function resolveSessionProviderModel(
  session: { modelProvider: string | null },
  agentSnapshot: Record<string, unknown>,
  modelConfig: Record<string, unknown>,
): { provider: string; model: string | null } {
  const provider =
    session.modelProvider ?? (typeof agentSnapshot.providerId === 'string' ? agentSnapshot.providerId : 'workers-ai')
  const model =
    typeof modelConfig.model === 'string'
      ? modelConfig.model
      : typeof agentSnapshot.model === 'string'
        ? agentSnapshot.model
        : null
  return { provider, model }
}

export function parseRuntimeAgentSnapshot(value: string | null) {
  const snapshot = value ? (JSON.parse(value) as Record<string, unknown>) : {}
  const { sandboxPolicy: _sandboxPolicy, ...runtimeSnapshot } = snapshot
  return {
    ...runtimeSnapshot,
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  }
}

// ── The shared callback bundle ────────────────────────────────────────────────

export type SandboxPolicyBlock = NonNullable<Awaited<ReturnType<typeof policyBlocksSandboxOperation>>>

export interface SessionTurnCallbacks {
  ensureActive: () => Promise<void>
  onEvent: (event: Record<string, unknown>, metadata?: Record<string, unknown>) => Promise<void>
  resolveToolResult: (input: RuntimeToolPolicyInput) => Promise<Record<string, unknown> | null>
  approveToolCall: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision>
  approvalGate: ReturnType<typeof createToolApprovalGate>
  wasPolicyDenied: () => boolean
}

export function buildSessionTurnCallbacks(deps: {
  repo: Repo
  auth: AuthScope
  session: SessionRow
  // Records a sandbox-policy denial. Injected because the cloud path inlines the
  // event+audit while the proxy path uses denyRuntimePolicy — keeping both exact.
  recordPolicyDenial: (blocked: SandboxPolicyBlock) => Promise<void>
}): SessionTurnCallbacks {
  const { repo, auth, session, recordPolicyDenial } = deps
  const sessionId = session.id
  const ensureActive = async () => {
    await assertRuntimeSessionRunning(repo, auth.project.id, sessionId)
  }
  const approvalGate = createToolApprovalGate({
    db: repo.db,
    auth,
    sessionId,
    sessionMetadata: parseJson<Record<string, unknown>>(session.metadata) ?? {},
    appendEvent: (event, metadata) => appendRuntimeEvent(repo, { auth, sessionId, event, metadata }),
  })
  let policyDeniedToolCall = false
  const onEvent = async (event: Record<string, unknown>, metadata?: Record<string, unknown>) => {
    if (approvalGate.shouldSuppressEvent(event)) {
      return
    }
    await ensureActive()
    await appendRuntimeEvent(repo, { auth, sessionId, event, ...(metadata ? { metadata } : {}) })
  }
  const approveToolCall = async ({ toolCallId, toolName, input }: RuntimeToolPolicyInput) => {
    await ensureActive()
    // Sandbox executor seam: command and outbound network tool calls are gated by
    // sandbox and environment network policy before execution.
    const blocked = await policyBlocksSandboxOperation(repo.db, auth, {
      session: {
        id: sessionId,
        agentSnapshot: session.agentSnapshot,
        environmentSnapshot: session.environmentSnapshot,
      },
      toolName,
      input,
    })
    if (blocked) {
      await ensureActive()
      await recordPolicyDenial(blocked)
      await ensureActive()
      policyDeniedToolCall = true
      return { allowed: false, reason: blocked.decision.message }
    }
    const approvalDecision = await approvalGate.gate({ toolCallId, toolName, input })
    if (approvalDecision) {
      return approvalDecision
    }
    return { allowed: true }
  }
  return {
    ensureActive,
    onEvent,
    resolveToolResult: (input) => approvalGate.resolveToolResult(input),
    approveToolCall,
    approvalGate,
    wasPolicyDenied: () => policyDeniedToolCall,
  }
}

// ── Runtime-endpoint proxy turn lifecycle ─────────────────────────────────────

export async function recordRuntimeMessageSubmission(repo: Repo, auth: AuthScope, session: SessionRow) {
  const updated = await repo.updateSessionWhenState(auth.project.id, session.id, ['idle', 'running'], {
    state: 'running',
    stateReason: null,
    updatedAt: new Date().toISOString(),
  })
  if (!updated) {
    throw new Error('Session runtime is no longer active')
  }
}

export async function recordRuntimeMessageOutcome(
  repo: Repo,
  env: Env,
  auth: AuthScope,
  session: SessionRow,
  body: unknown,
) {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (env.AMA_RUNTIME_MODE !== 'test' && runtimeRequestHasTestOnlyFields(body)) {
    throw new Error('Runtime clients cannot submit tool calls, tool results, or simulated runtime outcomes')
  }
  if (env.AMA_RUNTIME_MODE === 'test' && record.simulateError) {
    throw new Error(typeof record.errorMessage === 'string' ? record.errorMessage : 'Runtime message failed')
  }

  const prompt = typeof record.message === 'string' ? record.message.trim() : ''
  if (!prompt) {
    throw new Error('Runtime prompt message is required')
  }
  const agentSnapshot = parseRuntimeAgentSnapshot(session.agentSnapshot)
  const modelConfig = session.modelConfig ? (JSON.parse(session.modelConfig) as Record<string, unknown>) : {}
  const messages = await loadRuntimeMessages(repo, session.id)
  const { provider, model } = resolveSessionProviderModel(session, agentSnapshot, modelConfig)
  const callbacks = buildSessionTurnCallbacks({
    repo,
    auth,
    session,
    recordPolicyDenial: async (blocked) => {
      await denyRuntimePolicy(repo, auth, {
        sessionId: session.id,
        decision: blocked.decision,
        action: 'runtime_sandbox.operation',
        resourceType: blocked.operation.resourceType,
        resourceId: blocked.operation.resourceId,
        payload: {
          operation: blocked.operation.operation,
          ...(blocked.operation.operation === 'command'
            ? { command: blocked.operation.command }
            : { host: blocked.operation.host }),
        },
      })
    },
  })
  let result: Awaited<ReturnType<typeof runSessionTurn>>
  try {
    result = await runSessionTurn(env, {
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      provider,
      model,
      agentSnapshot,
      prompt,
      messages,
      ensureActive: callbacks.ensureActive,
      onEvent: callbacks.onEvent,
      resolveToolResult: callbacks.resolveToolResult,
      approveToolCall: callbacks.approveToolCall,
    })
  } catch (error) {
    // The agent loop may wrap the denial thrown inside tool execution; rethrow it
    // typed so the proxy maps it to the policy-denied outcome.
    if (callbacks.wasPolicyDenied() && !isRuntimeTurnCancelled(error)) {
      throw new RuntimePolicyDeniedError(safeRuntimeError(error).message)
    }
    throw error
  }
  if (result.status === 'idle') {
    await repo.updateSessionWhenState(auth.project.id, session.id, 'running', {
      state: 'idle',
      updatedAt: new Date().toISOString(),
    })
  }
}

export async function markRuntimeExecutionFailed(repo: Repo, auth: AuthScope, session: SessionRow, error: unknown) {
  if (isRuntimeTurnCancelled(error)) {
    return safeRuntimeError(error)
  }
  const runtimeError = safeRuntimeError(error)
  await appendRuntimeEvent(repo, {
    auth,
    sessionId: session.id,
    event: { type: 'error', message: runtimeError.message, code: runtimeError.code },
    metadata: { source: 'ama-cloud-runtime' },
  })
  // A governance denial fails the turn but is an expected product outcome: the
  // session returns to idle so the operator can continue with allowed work.
  const failedState = isRuntimePolicyDenied(error)
    ? { state: 'idle' as const, stateReason: 'policy-denied' }
    : { state: 'error' as const, stateReason: runtimeError.message }
  await repo.updateSessionWhenState(auth.project.id, session.id, 'running', {
    ...failedState,
    updatedAt: new Date().toISOString(),
  })
  return runtimeError
}
