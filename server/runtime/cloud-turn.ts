// Shim: the cloud-turn LOOP (cloud turn execution, runtime startup, and the
// queue consumer) now lives in usecases/runtime/cloud-turn as deps-first
// functions over ports. These wrappers preserve the (env, db, ...) signatures
// the runtime callers (session-create, session-prompt, session-approval) and the
// queue worker (via the session-orchestration barrel) rely on, building the
// CloudTurnDeps subset inline and delegating. The CloudTurnOutcome type is
// re-exported. Deleted once the callers thread Deps directly.

import { createAuditPort } from '../adapters/gateways/audit'
import { createPolicyPort } from '../adapters/gateways/policy'
import {
  createRuntimeOrchestrationRepo,
  createRuntimeOrchestrationRepoFromBinding,
  type SessionRow,
} from '../adapters/repos/runtime-orchestration'
import { toolExecutor } from '../adapters/runtime/sandbox-tool-executor'
import type { RuntimeName } from '../contracts/environment-contracts'
import type { Env } from '../env'
import type { AuthScope, CloudTurnMessage, SandboxRuntimeHost } from '../usecases/ports'
import {
  type CloudTurnDeps,
  type CloudTurnOutcome,
  consumeCloudTurnMessage as consumeCloudTurnMessageUsecase,
  dispatchInitialPrompt as dispatchInitialPromptUsecase,
  executeCloudSessionTurn as executeCloudSessionTurnUsecase,
  markCloudTurnDeadLettered as markCloudTurnDeadLetteredUsecase,
  startSessionRuntimeForRow as startSessionRuntimeForRowUsecase,
} from '../usecases/runtime/cloud-turn'
import type { RuntimeSecretEnvEntry } from './secret-env'
import { resolveRuntimeSecretEnv } from './secret-env'
import type { Db, Repo } from './session-base'
import { executeRuntimeToolCalls, runSessionTurn, startSessionRuntime, stopSessionRuntime } from './session-runtime'
import type { NormalizedEnvironmentSnapshot, ResourceRef, SerializedAgentVersion } from './session-snapshot'
import { createToolApprovalGate } from './tool-approvals'
import { cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'

export type { CloudTurnOutcome }

// The cloud sandbox runtime host, routed through the env-bound session-runtime
// shim so the existing runtime tests' mocks of startSessionRuntime /
// stopSessionRuntime / runSessionTurn (mocked at ./session-runtime) keep flowing
// through the port surface.
function cloudSandboxRuntime(env: Env): SandboxRuntimeHost {
  return {
    startCloudSession(input) {
      return startSessionRuntime(env, input)
    },
    stopCloudSession(sandboxId) {
      return stopSessionRuntime(env, sandboxId)
    },
    executeToolCalls(input) {
      return executeRuntimeToolCalls(env, input)
    },
    executeTool(input) {
      return toolExecutor(env).execute(input)
    },
    runTurn(input) {
      return runSessionTurn(env, input)
    },
  }
}

// The cloud-turn queue, routed through the env-bound turn-queue shim so the
// existing runtime tests' mocks (enqueueCloudTurn / cloudTurnsRunInline) keep
// flowing through the port surface.
function cloudTurnQueue(env: Env) {
  return {
    enqueue: (message: CloudTurnMessage, opts?: { delaySeconds?: number }) =>
      opts ? enqueueCloudTurn(env, message, opts) : enqueueCloudTurn(env, message),
    runsInline: () => cloudTurnsRunInline(env),
  }
}

// The runtime secret-env gateway, routed through the env-bound secret-env shim.
function runtimeSecretEnv(env: Env, db: Db) {
  return {
    resolve: (scope: { organizationId: string; projectId: string }, items: unknown) =>
      resolveRuntimeSecretEnv(env, db, scope, items),
  }
}

// The approval gate factory seam, routed through the tool-approvals shim so its
// createToolApprovalGate stays the single gate constructor.
function approvalGateSeam(db: Db) {
  return (values: {
    auth: AuthScope
    sessionId: string
    sessionMetadata: Record<string, unknown>
    appendEvent: (event: Record<string, unknown>, metadata: Record<string, unknown>) => Promise<string>
  }) => createToolApprovalGate({ db, ...values })
}

export function cloudTurnDeps(env: Env, repo: Repo): CloudTurnDeps {
  return {
    sessionOrchestration: repo,
    policy: createPolicyPort(repo.db),
    audit: createAuditPort(repo.db),
    sandboxRuntime: cloudSandboxRuntime(env),
    cloudTurnQueue: cloudTurnQueue(env),
    runtimeSecretEnv: runtimeSecretEnv(env, repo.db),
    createApprovalGate: approvalGateSeam(repo.db),
  }
}

export async function startSessionRuntimeForRow(
  env: Env,
  db: Db,
  auth: AuthScope,
  input: {
    pending: SessionRow
    agentSnapshot: SerializedAgentVersion
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs: ResourceRef[]
    env?: Record<string, string>
    secretEnv?: RuntimeSecretEnvEntry[]
    initialPrompt?: string
  },
) {
  await startSessionRuntimeForRowUsecase(cloudTurnDeps(env, createRuntimeOrchestrationRepo(db)), auth, input)
}

export async function executeCloudSessionTurn(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.initial_prompt' | 'session.command',
): Promise<CloudTurnOutcome> {
  return executeCloudSessionTurnUsecase(
    cloudTurnDeps(env, createRuntimeOrchestrationRepo(db)),
    auth,
    session,
    work,
    auditAction,
  )
}

export async function dispatchInitialPrompt(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  initialPrompt: string,
) {
  await dispatchInitialPromptUsecase(
    cloudTurnDeps(env, createRuntimeOrchestrationRepo(db)),
    auth,
    session,
    initialPrompt,
  )
}

export async function consumeCloudTurnMessage(env: Env, message: CloudTurnMessage): Promise<void> {
  await consumeCloudTurnMessageUsecase(cloudTurnDeps(env, createRuntimeOrchestrationRepoFromBinding(env.DB)), message)
}

export async function markCloudTurnDeadLettered(env: Env, message: CloudTurnMessage): Promise<void> {
  await markCloudTurnDeadLetteredUsecase(cloudTurnDeps(env, createRuntimeOrchestrationRepoFromBinding(env.DB)), message)
}
