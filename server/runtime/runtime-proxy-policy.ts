// Shim: the effectful sandbox-policy helpers now live in usecases/runtime/proxy
// as deps-first functions. These wrappers preserve the (repo, auth, ...)
// signatures the runtime-proxy handler relies on by constructing the
// store/audit/policy deps inline and delegating. The pure parse/route helpers
// are re-exported straight from domain/runtime/proxy-route. Deleted once the
// proxy handler threads Deps directly.

import { createAuditPort } from '../adapters/gateways/audit'
import { createPolicyPort } from '../adapters/gateways/policy'
import type { PolicyDecision } from '../policy'
import type { AuthScope, SessionRow } from '../usecases/ports'
import {
  denyRuntimePolicy as denyRuntimePolicyUsecase,
  evaluateRuntimeSandboxOperations as evaluateRuntimeSandboxOperationsUsecase,
} from '../usecases/runtime'
import type { Repo } from './session-base'

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
  await denyRuntimePolicyUsecase({ sessionOrchestration: repo, audit: createAuditPort(repo.db) }, auth, values)
}

export async function evaluateRuntimeSandboxOperations(
  repo: Repo,
  auth: AuthScope,
  session: SessionRow,
  body: unknown,
) {
  return evaluateRuntimeSandboxOperationsUsecase({ policy: createPolicyPort(repo.db) }, auth, session, body)
}
