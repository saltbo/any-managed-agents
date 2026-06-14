import type { SessionRow } from '../adapters/repos/runtime-orchestration'
import type { AuthContext } from '../auth/session'
import type { Env } from '../env'
import { policyBlocksSandboxOperation } from '../policy'
import { safeRuntimeError } from './runtime-error'
import {
  appendRuntimeEvent,
  denyRuntimePolicy,
  newId,
  type Repo,
  runtimeRequestHasTestOnlyFields,
} from './runtime-proxy-policy'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  RuntimePolicyDeniedError,
  runSessionTurn,
} from './session-runtime'
import { createToolApprovalGate } from './tool-approvals'
import { assertRuntimeSessionRunning, loadRuntimeMessages, resolveSessionProviderModel } from './turn-runner'

export function parseRuntimeAgentSnapshot(value: string | null) {
  const snapshot = value ? (JSON.parse(value) as Record<string, unknown>) : {}
  const { sandboxPolicy: _sandboxPolicy, ...runtimeSnapshot } = snapshot
  return {
    ...runtimeSnapshot,
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  }
}

export async function recordRuntimeMessageSubmission(
  repo: Repo,
  auth: AuthContext,
  session: SessionRow,
  _body: unknown,
) {
  const timestamp = new Date().toISOString()
  const correlationId = newId('message')
  const updated = await repo.updateSessionWhenState(auth.project.id, session.id, ['idle', 'running'], {
    state: 'running',
    stateReason: null,
    updatedAt: timestamp,
  })
  if (!updated) {
    throw new Error('Session runtime is no longer active')
  }
  return correlationId
}

export async function recordRuntimeMessageOutcome(
  repo: Repo,
  env: Env,
  auth: AuthContext,
  session: SessionRow,
  body: unknown,
  _correlationId: string,
  _options: { executeTools: boolean },
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
  const ensureActive = async () => {
    await assertRuntimeSessionRunning(repo, auth.project.id, session.id)
  }
  const approvalGate = createToolApprovalGate({
    db: repo.db,
    auth,
    sessionId: session.id,
    sessionMetadata: session.metadata ? (JSON.parse(session.metadata) as Record<string, unknown>) : {},
    appendEvent: (event, metadata) => appendRuntimeEvent(repo, { auth, sessionId: session.id, event, metadata }),
  })
  // The agent loop may wrap the denial thrown inside tool execution, so the
  // approval callback records the denial and the catch below rethrows typed.
  let policyDeniedToolCall = false
  const runTurn = () =>
    runSessionTurn(env, {
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      provider,
      model,
      agentSnapshot,
      prompt,
      messages,
      ensureActive,
      onEvent: async (event, metadata) => {
        if (approvalGate.shouldSuppressEvent(event)) {
          return
        }
        await ensureActive()
        await appendRuntimeEvent(repo, {
          auth,
          sessionId: session.id,
          event,
          ...(metadata ? { metadata } : {}),
        })
      },
      resolveToolResult: (input) => approvalGate.resolveToolResult(input),
      approveToolCall: async ({ toolCallId, toolName, input }) => {
        await ensureActive()
        // Sandbox executor seam: command and outbound network tool calls are
        // gated by sandbox and environment network policy before execution.
        const blocked = await policyBlocksSandboxOperation(repo.db, auth, {
          session: {
            id: session.id,
            agentSnapshot: session.agentSnapshot,
            environmentSnapshot: session.environmentSnapshot,
          },
          toolName,
          input,
        })
        if (blocked) {
          await ensureActive()
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
  let result: Awaited<ReturnType<typeof runTurn>>
  try {
    result = await runTurn()
  } catch (error) {
    if (policyDeniedToolCall && !isRuntimeTurnCancelled(error)) {
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

export async function markRuntimeExecutionFailed(repo: Repo, auth: AuthContext, session: SessionRow, error: unknown) {
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
  // A governance denial fails the turn but is an expected product outcome:
  // the session returns to idle so the operator can continue with allowed work.
  const failedState = isRuntimePolicyDenied(error)
    ? { state: 'idle' as const, stateReason: 'policy-denied' }
    : { state: 'error' as const, stateReason: runtimeError.message }
  await repo.updateSessionWhenState(auth.project.id, session.id, 'running', {
    ...failedState,
    updatedAt: new Date().toISOString(),
  })
  return runtimeError
}
