// Shim: the shared turn-callback bundle and the runtime-endpoint proxy turn
// lifecycle now live in usecases/runtime/{turn-callbacks,proxy} as deps-first
// functions. These wrappers preserve the (repo, env, ...) signatures the current
// runtime callers (cloud-turn, runtime-proxy) rely on by constructing the
// store/policy/audit/sandbox-runtime deps inline and delegating. The pure
// snapshot/provider helpers are re-exported straight from domain/runtime.
// Deleted once the callers thread Deps directly.

import { createAuditPort } from '../adapters/gateways/audit'
import { createPolicyPort } from '../adapters/gateways/policy'
import { createSandboxRuntimeHost } from '../adapters/runtime/sandbox-runtime-host'
import type { Env } from '../env'
import type { AuthScope, SandboxPolicyBlock, SessionRow } from '../usecases/ports'
import {
  assertRuntimeSessionRunning as assertRuntimeSessionRunningUsecase,
  buildSessionTurnCallbacks as buildSessionTurnCallbacksUsecase,
  loadRuntimeMessages as loadRuntimeMessagesUsecase,
  markRuntimeExecutionFailed as markRuntimeExecutionFailedUsecase,
  recordRuntimeMessageOutcome as recordRuntimeMessageOutcomeUsecase,
  recordRuntimeMessageSubmission as recordRuntimeMessageSubmissionUsecase,
  type SessionTurnCallbacks,
} from '../usecases/runtime'
import type { Repo } from './session-base'
import { createToolApprovalGate } from './tool-approvals'

export { parseRuntimeAgentSnapshot, resolveSessionProviderModel } from '../domain/runtime/provider'
export type { SandboxPolicyBlock, SessionTurnCallbacks }

export async function loadRuntimeMessages(repo: Repo, sessionId: string) {
  return loadRuntimeMessagesUsecase({ sessionOrchestration: repo }, sessionId)
}

export async function assertRuntimeSessionRunning(repo: Repo, projectId: string, sessionId: string) {
  await assertRuntimeSessionRunningUsecase({ sessionOrchestration: repo }, projectId, sessionId)
}

// The approval gate factory seam threaded into buildSessionTurnCallbacks. Routed
// through the tool-approvals shim so its createToolApprovalGate stays the single
// gate constructor (and stays mockable for the golden-master turn-driver test).
function approvalGateSeam(repo: Repo) {
  return (values: {
    auth: AuthScope
    sessionId: string
    sessionMetadata: Record<string, unknown>
    appendEvent: (event: Record<string, unknown>, metadata: Record<string, unknown>) => Promise<string>
  }) => createToolApprovalGate({ db: repo.db, ...values })
}

export function buildSessionTurnCallbacks(deps: {
  repo: Repo
  auth: AuthScope
  session: SessionRow
  recordPolicyDenial: (blocked: SandboxPolicyBlock) => Promise<void>
}): SessionTurnCallbacks {
  return buildSessionTurnCallbacksUsecase(
    {
      sessionOrchestration: deps.repo,
      policy: createPolicyPort(deps.repo.db),
      createApprovalGate: approvalGateSeam(deps.repo),
    },
    { auth: deps.auth, session: deps.session, recordPolicyDenial: deps.recordPolicyDenial },
  )
}

function proxyTurnDeps(repo: Repo, env: Env) {
  return {
    sessionOrchestration: repo,
    policy: createPolicyPort(repo.db),
    audit: createAuditPort(repo.db),
    sandboxRuntime: createSandboxRuntimeHost(env),
    createApprovalGate: approvalGateSeam(repo),
  }
}

export async function recordRuntimeMessageSubmission(repo: Repo, auth: AuthScope, session: SessionRow) {
  await recordRuntimeMessageSubmissionUsecase({ sessionOrchestration: repo }, auth, session)
}

export async function recordRuntimeMessageOutcome(
  repo: Repo,
  env: Env,
  auth: AuthScope,
  session: SessionRow,
  body: unknown,
) {
  await recordRuntimeMessageOutcomeUsecase(proxyTurnDeps(repo, env), auth, session, body, env.AMA_RUNTIME_MODE)
}

export async function markRuntimeExecutionFailed(repo: Repo, auth: AuthScope, session: SessionRow, error: unknown) {
  return markRuntimeExecutionFailedUsecase({ sessionOrchestration: repo }, auth, session, error)
}
