// Shim: approval-decision continuation now lives in
// usecases/runtime/session-approval as deps-first functions over ports. This
// wrapper preserves the (env, db, ...) signature the gateway adapter relies on,
// building the cloud-turn deps subset inline and delegating. Deleted once the
// callers thread Deps directly.

import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'
import {
  type ApprovalDecisionResult,
  type ApprovalRowOutput,
  decideSessionApproval as decideSessionApprovalUsecase,
} from '../usecases/runtime'
import { cloudTurnDeps } from './cloud-turn'
import type { Db } from './session-base'

export type { ApprovalDecisionResult, ApprovalRowOutput }

export async function decideSessionApproval(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  approvalId: string,
  body: { decision: 'approve' | 'deny'; reason?: string; result?: Record<string, unknown> },
): Promise<ApprovalDecisionResult> {
  return decideSessionApprovalUsecase(
    cloudTurnDeps(env, createRuntimeOrchestrationRepo(db)),
    auth,
    sessionId,
    approvalId,
    body,
  )
}
