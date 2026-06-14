// Runtime-endpoint proxy turn lifecycle + sandbox-policy effects, deps-first.
//
// This is the effectful half of the old runtime-proxy-policy + the proxy turn
// driver: the message submission/outcome lifecycle that drives the runtime-core
// engine through deps.sandboxRuntime.runTurn over the shared callback bundle,
// the policy-denial recording (event + audit), and the per-request sandbox
// operation evaluation. The pure parse/route helpers stay in
// domain/runtime/proxy-route; only the effectful composition lives here.
//
// Deps-first: persistence + event append go through deps.sessionOrchestration,
// audit through deps.audit, sandbox/network policy through deps.policy, and the
// model turn through deps.sandboxRuntime. No Env: the runtime mode rides in as a
// value so the usecase stays infra-free.

import { parseRuntimeAgentSnapshot, resolveSessionProviderModel } from '@server/domain/runtime/provider'
import {
  runtimeRequestHasTestOnlyFields,
  runtimeToolCalls,
  sandboxOperationFromToolCall,
} from '@server/domain/runtime/proxy-route'
import { now } from '@server/domain/runtime/util'
import { safeRuntimeError } from '@server/runtime/runtime-error'
import { isRuntimePolicyDenied, isRuntimeTurnCancelled, RuntimePolicyDeniedError } from '../../../runtime-core/errors'
import type {
  AuditPort,
  AuthScope,
  PolicyDecisionResult,
  PolicyPort,
  SandboxRuntimeHost,
  SessionOrchestrationStore,
  SessionRow,
} from '../ports'
import type { ToolApprovalGate } from './approval-gate'
import { appendRuntimeEvent, loadRuntimeMessages } from './events'
import { buildSessionTurnCallbacks, type SessionTurnCallbacks } from './turn-callbacks'

// ── Sandbox-policy effects (event + audit) ────────────────────────────────────

async function appendRuntimePolicyEvent(
  deps: { sessionOrchestration: SessionOrchestrationStore; audit: AuditPort },
  values: {
    auth: AuthScope
    sessionId: string
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  },
) {
  await appendRuntimeEvent(deps, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: {
      type: 'policy_denied',
      ...values.payload,
    },
    metadata: { source: 'policy', ...(values.metadata ?? {}) },
  })
  await deps.audit.record(values.auth, {
    action: 'runtime.policy',
    resourceType: 'session',
    resourceId: values.sessionId,
    outcome: 'denied',
    metadata: values.payload,
  })
}

export async function denyRuntimePolicy(
  deps: { sessionOrchestration: SessionOrchestrationStore; audit: AuditPort },
  auth: AuthScope,
  values: {
    sessionId: string
    decision: PolicyDecisionResult
    requestId?: string | null
    action: string
    resourceType: string
    resourceId: string | null
    payload: Record<string, unknown>
  },
) {
  const payload = {
    category: values.decision.category,
    ruleId: values.decision.rule,
    resourceType: values.resourceType,
    resourceId: values.resourceId,
    decision: values.decision,
    ...values.payload,
  }
  await appendRuntimePolicyEvent(deps, { auth, sessionId: values.sessionId, payload })
  await deps.audit.record(auth, {
    action: values.action,
    resourceType: values.resourceType,
    resourceId: values.resourceId,
    outcome: 'denied',
    requestId: values.requestId ?? null,
    sessionId: values.sessionId,
    policyCategory: values.decision.category,
    metadata: payload,
  })
}

export async function evaluateRuntimeSandboxOperations(
  deps: { policy: PolicyPort },
  auth: AuthScope,
  session: SessionRow,
  body: unknown,
) {
  for (const call of runtimeToolCalls(body)) {
    const operation = sandboxOperationFromToolCall(call)
    if (!operation) {
      continue
    }
    const decision = await deps.policy.evaluateSandboxRuntime(auth, {
      session: {
        id: session.id,
        agentSnapshot: session.agentSnapshot,
        environmentSnapshot: session.environmentSnapshot,
      },
      operation: operation.operation,
      command: 'command' in operation ? operation.command : null,
      host: 'host' in operation ? operation.host : null,
    })
    if (!decision.allowed) {
      return {
        decision,
        operation,
      }
    }
  }
  return null
}

// ── Proxy turn lifecycle ──────────────────────────────────────────────────────

type ProxyTurnDeps = {
  sessionOrchestration: SessionOrchestrationStore
  policy: PolicyPort
  audit: AuditPort
  sandboxRuntime: SandboxRuntimeHost
  // The approval gate factory threaded into buildSessionTurnCallbacks.
  createApprovalGate: (values: {
    auth: AuthScope
    sessionId: string
    sessionMetadata: Record<string, unknown>
    appendEvent: (event: Record<string, unknown>, metadata: Record<string, unknown>) => Promise<string>
  }) => ToolApprovalGate
}

export async function recordRuntimeMessageSubmission(
  deps: { sessionOrchestration: SessionOrchestrationStore },
  auth: AuthScope,
  session: SessionRow,
) {
  const updated = await deps.sessionOrchestration.updateSessionWhenState(
    auth.project.id,
    session.id,
    ['idle', 'running'],
    {
      state: 'running',
      stateReason: null,
      updatedAt: now(),
    },
  )
  if (!updated) {
    throw new Error('Session runtime is no longer active')
  }
}

export async function recordRuntimeMessageOutcome(
  deps: ProxyTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  body: unknown,
  runtimeMode: string | undefined,
) {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (runtimeMode !== 'test' && runtimeRequestHasTestOnlyFields(body)) {
    throw new Error('Runtime clients cannot submit tool calls, tool results, or simulated runtime outcomes')
  }
  if (runtimeMode === 'test' && record.simulateError) {
    throw new Error(typeof record.errorMessage === 'string' ? record.errorMessage : 'Runtime message failed')
  }

  const prompt = typeof record.message === 'string' ? record.message.trim() : ''
  if (!prompt) {
    throw new Error('Runtime prompt message is required')
  }
  const agentSnapshot = parseRuntimeAgentSnapshot(session.agentSnapshot)
  const modelConfig = session.modelConfig ? (JSON.parse(session.modelConfig) as Record<string, unknown>) : {}
  const messages = await loadRuntimeMessages(deps, session.id)
  const { provider, model } = resolveSessionProviderModel(session, agentSnapshot, modelConfig)
  const callbacks: SessionTurnCallbacks = buildSessionTurnCallbacks(deps, {
    auth,
    session,
    recordPolicyDenial: async (blocked) => {
      await denyRuntimePolicy(deps, auth, {
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
  let result: Awaited<ReturnType<SandboxRuntimeHost['runTurn']>>
  try {
    result = await deps.sandboxRuntime.runTurn({
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
    await deps.sessionOrchestration.updateSessionWhenState(auth.project.id, session.id, 'running', {
      state: 'idle',
      updatedAt: now(),
    })
  }
}

export async function markRuntimeExecutionFailed(
  deps: { sessionOrchestration: SessionOrchestrationStore },
  auth: AuthScope,
  session: SessionRow,
  error: unknown,
) {
  if (isRuntimeTurnCancelled(error)) {
    return safeRuntimeError(error)
  }
  const runtimeError = safeRuntimeError(error)
  await appendRuntimeEvent(deps, {
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
  await deps.sessionOrchestration.updateSessionWhenState(auth.project.id, session.id, 'running', {
    ...failedState,
    updatedAt: now(),
  })
  return runtimeError
}
