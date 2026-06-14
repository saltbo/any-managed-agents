// Shim: create-session provisioning now lives in usecases/runtime/provisioning
// as deps-first functions. These wrappers preserve the (db,...) signatures the
// current runtime callers rely on by constructing the store/policy deps inline
// and delegating. Deleted once the callers thread Deps directly.

import { createPolicyPort } from '../adapters/gateways/policy'
import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import type { RuntimeName } from '../contracts/environment-contracts'
import type { AuthScope } from '../usecases/ports'
import {
  resolveMcpSnapshot as resolveMcpSnapshotUsecase,
  resolveSessionProviderId as resolveSessionProviderIdUsecase,
  validateRuntimeProviderModel as validateRuntimeProviderModelUsecase,
} from '../usecases/runtime'
import type { Db } from './session-base'
import type { NormalizedEnvironmentSnapshot, SerializedAgentVersion } from './session-snapshot'

export { mcpConnectorIds } from '../usecases/runtime'

function runtimeUsecaseDeps(db: Db) {
  return { sessionOrchestration: createRuntimeOrchestrationRepo(db), policy: createPolicyPort(db) }
}

export async function resolveSessionProviderId(db: Db, projectId: string, providerId: string | null) {
  return resolveSessionProviderIdUsecase(runtimeUsecaseDeps(db), projectId, providerId)
}

export async function validateRuntimeProviderModel(
  db: Db,
  auth: AuthScope,
  environmentId: string,
  hostingMode: 'cloud' | 'self_hosted',
  runtime: RuntimeName,
  provider: string,
  model: string | null,
) {
  return validateRuntimeProviderModelUsecase(
    runtimeUsecaseDeps(db),
    auth,
    environmentId,
    hostingMode,
    runtime,
    provider,
    model,
  )
}

export async function resolveMcpSnapshot(
  db: Db,
  auth: AuthScope,
  sessionId: string,
  agentSnapshot: SerializedAgentVersion,
  environmentSnapshot: NormalizedEnvironmentSnapshot | null,
) {
  return resolveMcpSnapshotUsecase(runtimeUsecaseDeps(db), auth, sessionId, agentSnapshot, environmentSnapshot)
}
