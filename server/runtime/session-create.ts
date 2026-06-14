// Shim: create-session orchestration now lives in usecases/runtime/session-create
// as deps-first functions over ports. These wrappers preserve the (env, db, ...)
// signatures the gateway adapter relies on, building the CreateSessionDeps subset
// inline and delegating. The create flow's direct audit/policy calls route
// through the env-bound ../audit and ../policy modules so existing runtime-test
// mocks at those paths keep intercepting; the inline cloud launch reuses the full
// cloud-turn gateways. Deleted once the callers thread Deps directly.

import { createPolicyPort } from '../adapters/gateways/policy'
import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import type { Env } from '../env'
import { evaluateProviderPolicyForSession, evaluateSandboxRuntimePolicy } from '../policy'
import type { AuditPort, AuthScope, PolicyPort } from '../usecases/ports'
import {
  type CreateSessionDeps,
  type CreateSessionOptions,
  type CreateSessionResult,
  createSessionForAgent as createSessionForAgentUsecase,
} from '../usecases/runtime'
import { cloudTurnDeps } from './cloud-turn'
import type { Db } from './session-base'

export type { CreateSessionOptions, CreateSessionResult }

// Audit routed through the env-bound recordAudit so the runtime tests' mock at
// ../audit keeps intercepting. record(auth, entry) → recordAudit(db, { auth, ...entry }).
function createAuditSeam(db: Db): AuditPort {
  return { record: (auth, entry) => recordAudit(db, { auth, ...entry }) }
}

// Policy with the session-creation decisions routed through the env-bound
// ../policy functions (mocked by the runtime tests); the rest of the PolicyPort
// surface (used by the inline cloud launch) flows through the real gateway.
function createPolicySeam(db: Db): PolicyPort {
  return {
    ...createPolicyPort(db),
    evaluateProviderForSession: (auth, values) => evaluateProviderPolicyForSession(db, auth, values),
    evaluateSandboxRuntime: (auth, values) => evaluateSandboxRuntimePolicy(db, auth, values),
  }
}

function createSessionDeps(env: Env, db: Db): CreateSessionDeps {
  return {
    ...cloudTurnDeps(env, createRuntimeOrchestrationRepo(db)),
    audit: createAuditSeam(db),
    policy: createPolicySeam(db),
    rereadStartedSession: env.AMA_RUNTIME_MODE === 'test',
  }
}

export async function createSessionForAgent(
  env: Env,
  db: Db,
  auth: AuthScope,
  agentId: string,
  environmentId: string,
  options: CreateSessionOptions,
  requestId: string | null,
): Promise<CreateSessionResult> {
  return createSessionForAgentUsecase(createSessionDeps(env, db), auth, agentId, environmentId, options, requestId)
}
