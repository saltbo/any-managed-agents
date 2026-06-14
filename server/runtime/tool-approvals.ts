// Shim: session tool approvals now live in usecases/runtime/approval-gate as
// deps-first functions. These wrappers preserve the (db,...) signatures the
// current runtime callers rely on by constructing the store/audit/policy deps
// inline and delegating. The pure approval-state read is re-exported straight
// from domain/runtime/approval-state. Deleted once the callers thread Deps
// directly.

import { createAuditPort } from '../adapters/gateways/audit'
import { createPolicyPort } from '../adapters/gateways/policy'
import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import type { AuthScope } from '../usecases/ports'
import {
  createToolApprovalGate as createToolApprovalGateUsecase,
  type ToolApprovalGate,
  writeSessionApprovalState as writeSessionApprovalStateUsecase,
} from '../usecases/runtime'
import type { Db } from './session-base'

export {
  type PendingSessionApproval,
  type SessionApprovalGrants,
  sessionApprovalState,
} from '../domain/runtime/approval-state'
export type { ToolApprovalGate }

function approvalGateDeps(db: Db) {
  return {
    sessionOrchestration: createRuntimeOrchestrationRepo(db),
    audit: createAuditPort(db),
    policy: createPolicyPort(db),
  }
}

export async function writeSessionApprovalState(
  db: Db,
  auth: AuthScope,
  sessionId: string,
  update: (metadata: Record<string, unknown>) => Record<string, unknown>,
) {
  return writeSessionApprovalStateUsecase(
    { sessionOrchestration: createRuntimeOrchestrationRepo(db) },
    auth,
    sessionId,
    update,
  )
}

export function createToolApprovalGate(values: {
  db: Db
  auth: AuthScope
  sessionId: string
  sessionMetadata: Record<string, unknown>
  appendEvent: (event: Record<string, unknown>, metadata: Record<string, unknown>) => Promise<string>
}): ToolApprovalGate {
  return createToolApprovalGateUsecase(approvalGateDeps(values.db), {
    auth: values.auth,
    sessionId: values.sessionId,
    sessionMetadata: values.sessionMetadata,
    appendEvent: values.appendEvent,
  })
}
