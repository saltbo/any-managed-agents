import type { SessionRow } from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import { runtimeToolCalls, sandboxOperationFromToolCall } from '../domain/runtime/proxy-route'
import { evaluateSandboxRuntimePolicy, type PolicyDecision } from '../policy'
import type { AuthScope } from '../usecases/ports'
import { appendRuntimeEvent, type Repo } from './session-base'

export {
  parseRuntimeProxyRoute,
  type RuntimeCommand,
  type RuntimeRoute,
  runtimeCommand,
  runtimeRequestHasTestOnlyFields,
  runtimeToolCalls,
  type SandboxOperation,
  sandboxOperationFromRuntimePath,
  sandboxOperationFromToolCall,
} from '../domain/runtime/proxy-route'

async function appendRuntimePolicyEvent(
  repo: Repo,
  values: {
    auth: AuthScope
    sessionId: string
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  },
) {
  await appendRuntimeEvent(repo, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: {
      type: 'policy_denied',
      ...values.payload,
    },
    metadata: { source: 'policy', ...(values.metadata ?? {}) },
  })
  await recordAudit(repo.db, {
    auth: values.auth,
    action: 'runtime.policy',
    resourceType: 'session',
    resourceId: values.sessionId,
    outcome: 'denied',
    metadata: values.payload,
  })
}

export async function denyRuntimePolicy(
  repo: Repo,
  auth: AuthScope,
  values: {
    sessionId: string
    decision: PolicyDecision
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
  await appendRuntimePolicyEvent(repo, { auth, sessionId: values.sessionId, payload })
  await recordAudit(repo.db, {
    auth,
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
  repo: Repo,
  auth: AuthScope,
  session: SessionRow,
  body: unknown,
) {
  for (const call of runtimeToolCalls(body)) {
    const operation = sandboxOperationFromToolCall(call)
    if (!operation) {
      continue
    }
    const decision = await evaluateSandboxRuntimePolicy(repo.db, auth, {
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
