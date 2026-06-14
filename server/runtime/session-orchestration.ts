// Runtime execution layer for sessions.
//
// This module owns the env-bound session machinery: the create-session
// orchestration (snapshot, provider/policy/runtime validation, session-row
// build, runtime launch), the cloud turn loop and its queue consumer, prompt
// dispatch (live channel vs queued), stop/archive runtime teardown, and the
// approval-decision continuation. It sits in server/runtime/ alongside the
// other runtime execution infrastructure (drivers, sandbox/DO bindings, the
// turn queue) and is consumed by the SessionRuntimeGateway adapter, the queue
// consumer (server/worker), and the scheduled-dispatch wrapper.
//
// Every public entry here is Response-free: HTTP concerns (Response, status
// codes, SSE) stay in server/http/sessions.ts. Outcomes cross the boundary as
// discriminated result objects.

import { runtimeRequiredRunnerCapability, runtimeSupportsLivePrompts } from '@server/domain/runtime-catalog'
import { type AgentRow, createRuntimeOrchestrationRepo, type SessionRow } from '../adapters/repos/runtime-orchestration'
import { toolExecutor } from '../adapters/runtime/sandbox-tool-executor'
import { recordAudit } from '../audit'
import type { RuntimeName } from '../contracts/environment-contracts'
import { environmentHostingMode, sessionRuntimeConfig, sessionRuntimeFromMetadata } from '../domain/runtime-session'
import { composeInitialPrompt, hasSecretMaterial } from '../domain/session'
import type { Env } from '../env'
import { evaluateProviderPolicyForSession, evaluateSandboxRuntimePolicy } from '../policy'
import type { AuthScope } from '../usecases/ports'
import { consumeCloudTurnMessage, executeCloudSessionTurn, startSessionRuntimeForRow } from './cloud-turn'
import { runtimeDriverName } from './drivers'
import { providerRuntimeEnv, resolveSessionProviderConfig } from './provider-env'
import { dispatchRunnerSessionCommand, hasAcceptedRunnerSessionChannel } from './runner-session-command'
import { safeRuntimeError } from './runtime-error'
import type { RuntimeSecretEnvEntry } from './secret-env'
import {
  appendRuntimeEvent,
  type Db,
  findSession,
  newId,
  now,
  RUNTIME_START_TIMEOUT_MS,
  requestIdFrom,
  stringify,
} from './session-base'
import { resolveSessionProviderId, validateRuntimeProviderModel } from './session-provisioning'
import { runtimeEndpointPath, stopSessionRuntime as stopCloudSessionRuntime } from './session-runtime'
import {
  type GitHubRepositoryResourceRef,
  type NormalizedEnvironmentSnapshot,
  normalizeEnvironmentSnapshot,
  normalizeResourceRefs,
  parseAgentSnapshot,
  parseJson,
  type ResourceRef,
  type SerializedAgentVersion,
  serializeAgentVersion,
  serializeEnvironmentVersion,
} from './session-snapshot'
import {
  type PendingSessionApproval,
  type SessionApprovalGrants,
  sessionApprovalState,
  writeSessionApprovalState,
} from './tool-approvals'
import { cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'

// Snapshot/resource shaping moved to ./session-snapshot; re-exported for the
// (type-only) public surface that historically lived here.
export type { GitHubRepositoryResourceRef, ResourceRef, SerializedAgentVersion, SessionRow }
// appendRuntimeEvent moved to ./session-base; re-exported for the public surface
// that historically lived here (consumed by runtime-proxy and the http layer).
// consumeCloudTurnMessage moved to ./cloud-turn; re-exported for the public
// surface that historically lived here (consumed by server/worker).
export { appendRuntimeEvent, consumeCloudTurnMessage }

type MessageDelivery = 'live' | 'queued'
type MessageState = 'accepted' | 'delivered' | 'failed'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

type SecretEnvEntry = { name: string; credentialRef: { credentialId: string; versionId?: string } }
type ResolvedSecretEnvEntry = { name: string; credentialRef: { credentialId: string; versionId: string } }

export interface CreateSessionOptions {
  title?: string
  metadata?: Record<string, unknown>
  resourceRefs?: ResourceRef[]
  runtime: RuntimeName
  runtimeConfig?: Record<string, unknown>
  env?: Record<string, string>
  secretEnv?: SecretEnvEntry[]
  initialPrompt?: string
  providerAccessOverride?: boolean
}

// Error code → http status mapping is the http layer's job; the gateway only
// reports the kind. `fields` carries field-keyed validation detail; `detail`
// carries the structured policy/conflict payload the http layer echoes.
export interface SessionRuntimeError {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

export type CreateSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

async function validateResourceCredentialRefs(db: Db, auth: AuthScope, resourceRefs: ResourceRef[]) {
  const credentialRefs = resourceRefs
    .filter((resourceRef): resourceRef is GitHubRepositoryResourceRef => resourceRef.type === 'github_repository')
    .map((resourceRef) => resourceRef.credentialRef)
    .filter((credentialRef): credentialRef is { credentialId: string; versionId?: string } => credentialRef != null)
  const repo = createRuntimeOrchestrationRepo(db)
  const seen = new Set<string>()
  for (const credentialRef of credentialRefs) {
    const dedupeKey = `${credentialRef.credentialId}:${credentialRef.versionId ?? ''}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    if (credentialRef.versionId) {
      const exists = await repo.activeCredentialVersionExists(
        auth.organization.id,
        auth.project.id,
        credentialRef.versionId,
      )
      if (!exists) {
        return {
          credentialRef: 'Credential version must exist, be active, and belong to this project or organization.',
        }
      }
      continue
    }
    const exists = await repo.activeCredentialExists(auth.organization.id, auth.project.id, credentialRef.credentialId)
    if (!exists) {
      return { credentialRef: 'Credential must exist, be active, and belong to this project or organization.' }
    }
  }
  return null
}

async function resolveSecretEnvEntries(
  db: Db,
  auth: AuthScope,
  secretEnv: SecretEnvEntry[],
): Promise<{ entries: ResolvedSecretEnvEntry[] } | { fields: Record<string, string> }> {
  const repo = createRuntimeOrchestrationRepo(db)
  const entries: ResolvedSecretEnvEntry[] = []
  const names = new Set<string>()
  for (const [index, entry] of secretEnv.entries()) {
    const field = `secretEnv.${index}`
    if (!ENV_NAME_PATTERN.test(entry.name)) {
      return { fields: { [`${field}.name`]: 'Use a valid environment variable name.' } }
    }
    if (names.has(entry.name)) {
      return { fields: { [`${field}.name`]: 'Secret environment variable names must be unique.' } }
    }
    names.add(entry.name)
    const credential = await repo.activeCredentialForSecretEnv(
      auth.organization.id,
      auth.project.id,
      entry.credentialRef.credentialId,
    )
    if (!credential) {
      return {
        fields: {
          [`${field}.credentialRef.credentialId`]:
            'Credential must exist, be active, and belong to this project or organization.',
        },
      }
    }
    const versionId = entry.credentialRef.versionId ?? credential.activeVersionId
    if (!versionId) {
      return { fields: { [`${field}.credentialRef.credentialId`]: 'Credential has no active version to resolve.' } }
    }
    if (!(await repo.activeVersionForCredentialExists(credential.id, versionId))) {
      return {
        fields: {
          [`${field}.credentialRef.versionId`]:
            'Credential version must exist, be active, and belong to the credential.',
        },
      }
    }
    entries.push({ name: entry.name, credentialRef: { credentialId: credential.id, versionId } })
  }
  return { entries }
}

// ── Session reads ───────────────────────────────────────────────────────────

async function currentAgentVersion(db: Db, agent: AgentRow) {
  if (!agent.currentVersionId) {
    return null
  }
  return createRuntimeOrchestrationRepo(db).findAgentVersion(agent.id, agent.currentVersionId)
}

async function sessionInitialPrompt(db: Db, projectId: string, agent: AgentRow, initialPrompt: string | undefined) {
  const memoryPolicy = parseJson<Record<string, unknown>>(agent.memoryPolicy) ?? {}
  if (memoryPolicy.enabled !== true) {
    return initialPrompt
  }
  const content = await createRuntimeOrchestrationRepo(db).agentMemoryContent(projectId, agent.id)
  return composeInitialPrompt(content, initialPrompt)
}

// ── Work item enqueue ───────────────────────────────────────────────────────

async function enqueueSelfHostedSessionWork(
  db: Db,
  auth: AuthScope,
  values: {
    session: SessionRow
    agentSnapshot: SerializedAgentVersion
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs?: ResourceRef[]
    env?: Record<string, string>
    secretEnv?: RuntimeSecretEnvEntry[]
    initialPrompt?: string
    resume?: boolean
    resumeToken?: string | null
  },
) {
  const timestamp = now()
  const payload = {
    protocol: 'ama-runner-work',
    type: 'session.start',
    sessionId: values.session.id,
    hostingMode: values.environmentSnapshot?.hostingMode ?? 'self_hosted',
    runtime: values.runtime,
    runtimeConfig: values.runtimeConfig,
    resourceRefs: values.resourceRefs ?? [],
    provider: values.agentSnapshot.providerId,
    ...(values.agentSnapshot.model ? { model: values.agentSnapshot.model } : {}),
    runtimeDriver: runtimeDriverName(values.runtime, 'self_hosted'),
    agentSnapshot: values.agentSnapshot,
    environmentSnapshot: values.environmentSnapshot,
    runtimeEnv: values.env ?? {},
    runtimeSecretEnv: values.secretEnv ?? [],
    initialPrompt: values.initialPrompt ?? null,
    resume: values.resume ?? false,
    resumeToken: values.resumeToken ?? null,
    requiredRunnerCapability:
      values.environmentSnapshot?.hostingMode === 'self_hosted'
        ? runtimeRequiredRunnerCapability(values.runtime, values.agentSnapshot.providerId, values.agentSnapshot.model)
        : null,
  }
  await createRuntimeOrchestrationRepo(db).insertWorkItem({
    id: newId('work'),
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    sessionId: values.session.id,
    environmentId: values.session.environmentId,
    runnerId: null,
    leaseId: null,
    type: 'session.start',
    state: 'available',
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    payload: stringify(payload),
    result: null,
    error: null,
    availableAt: timestamp,
    leaseExpiresAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

async function latestRunnerResumeToken(db: Db, auth: AuthScope, sessionId: string) {
  const rows = await createRuntimeOrchestrationRepo(db).recentSessionWorkItems(auth.project.id, sessionId, 5)
  for (const row of rows) {
    if (row.state === 'succeeded') {
      const result = parseJson<Record<string, unknown>>(row.result)
      if (typeof result?.resumeToken === 'string' && result.resumeToken) {
        return result.resumeToken
      }
    }
    const payload = parseJson<Record<string, unknown>>(row.payload)
    if (typeof payload?.resumeToken === 'string' && payload.resumeToken) {
      return payload.resumeToken
    }
  }
  return null
}

// ── Create session ──────────────────────────────────────────────────────────

export async function createSessionForAgent(
  env: Env,
  db: Db,
  auth: AuthScope,
  agentId: string,
  environmentId: string,
  options: CreateSessionOptions,
  requestId: string | null,
): Promise<CreateSessionResult> {
  if (
    hasSecretMaterial(options.metadata) ||
    hasSecretMaterial(options.resourceRefs) ||
    hasSecretMaterial(options.runtimeConfig) ||
    hasSecretMaterial(options.env)
  ) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session configuration',
        fields: {
          metadata: 'Secret material must be stored in vault references.',
          resourceRefs: 'Resource references must not contain secret material.',
          runtimeConfig: 'Secret material must be stored in vault references.',
          env: 'Session environment variables must not contain raw secret material.',
        },
      },
    }
  }
  const normalizedResources = normalizeResourceRefs(options.resourceRefs ?? [])
  if ('fields' in normalizedResources) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session resource references',
        fields: normalizedResources.fields,
      },
    }
  }

  const repo = createRuntimeOrchestrationRepo(db)
  const agent = await repo.findAgent(auth.project.id, agentId)
  if (!agent) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Agent not found' } }
  }
  if (agent.archivedAt) {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Archived agents cannot create sessions' } }
  }

  const agentVersion = await currentAgentVersion(db, agent)
  if (!agentVersion) {
    throw new Error('Agent current version is required')
  }
  const providerId = await resolveSessionProviderId(db, auth.project.id, agentVersion.providerId)
  const initialPrompt = await sessionInitialPrompt(db, auth.project.id, agent, options.initialPrompt)
  const { decision: policyDecision, override: policyOverride } = await evaluateProviderPolicyForSession(db, auth, {
    providerId,
    modelId: agentVersion.model,
    adminOverride: options.providerAccessOverride === true,
  })
  if (!policyDecision.allowed) {
    await recordAudit(db, {
      auth,
      action: 'session.create',
      resourceType: 'session',
      outcome: 'denied',
      requestId: requestIdFrom(requestId),
      policyCategory: policyDecision.category,
      metadata: { agentId, providerId, modelId: agentVersion.model, decision: policyDecision },
    })
    return {
      ok: false,
      error: {
        status: 403,
        code: 'policy_denied',
        message: policyDecision.message,
        detail: {
          category: policyDecision.category,
          resourceType:
            policyDecision.category === 'budget'
              ? 'budget'
              : policyDecision.category === 'model'
                ? 'model'
                : 'provider',
          resourceId:
            policyDecision.category === 'budget'
              ? policyDecision.rule
              : policyDecision.category === 'model'
                ? agentVersion.model
                : providerId,
          ruleId: policyDecision.rule,
        },
      },
    }
  }
  if (policyOverride) {
    await recordAudit(db, {
      auth,
      action: 'session.create',
      resourceType: 'session',
      outcome: 'success',
      requestId: requestIdFrom(requestId),
      policyCategory: 'override',
      metadata: {
        agentId,
        providerId,
        modelId: agentVersion.model,
        providerAccessOverride: true,
        overriddenDecision: policyOverride,
      },
    })
  }

  const providerResolution = await resolveSessionProviderConfig(db, auth.project.id, providerId)
  if (!providerResolution.ok) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Agent provider is not configured or unavailable for this project',
        detail: { resourceType: 'provider', resourceId: providerId, reason: providerResolution.reason },
      },
    }
  }
  const providerEnv = providerRuntimeEnv(providerResolution.config)
  const providerSecretResolution = await resolveSecretEnvEntries(db, auth, providerEnv.secretEnv)
  if ('fields' in providerSecretResolution) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Provider credential reference is not an active vault credential version',
        detail: { resourceType: 'provider', resourceId: providerId },
      },
    }
  }
  const providerSecretEntries = providerSecretResolution.entries

  const environment = await repo.findEnvironment(auth.project.id, environmentId)
  if (!environment?.currentVersionId) {
    return {
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Selected environment is archived or unavailable' },
    }
  }
  const environmentVersion = await repo.findEnvironmentVersion(auth.project.id, environment.currentVersionId)
  if (!environmentVersion) {
    return {
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Selected environment is archived or unavailable' },
    }
  }
  const credentialError = await validateResourceCredentialRefs(db, auth, normalizedResources.resourceRefs)
  if (credentialError) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session resource credential reference',
        fields: credentialError,
      },
    }
  }
  const resolvedSecretEnv = await resolveSecretEnvEntries(db, auth, options.secretEnv ?? [])
  if ('fields' in resolvedSecretEnv) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session secret environment references',
        fields: resolvedSecretEnv.fields,
      },
    }
  }

  const sessionEnv = options.env ?? {}
  const sessionSecretEnv = resolvedSecretEnv.entries
  const explicitEnvNames = new Set([...Object.keys(sessionEnv), ...sessionSecretEnv.map((item) => item.name)])
  const mergedEnv = {
    ...Object.fromEntries(Object.entries(providerEnv.env).filter(([name]) => !explicitEnvNames.has(name))),
    ...sessionEnv,
  }
  const mergedSecretEnv = [
    ...providerSecretEntries.filter((item) => !explicitEnvNames.has(item.name)),
    ...sessionSecretEnv,
  ]

  const timestamp = now()
  const id = crypto.randomUUID()
  const agentSnapshot = serializeAgentVersion(agentVersion, providerId)
  const baseEnvironmentSnapshot = normalizeEnvironmentSnapshot(serializeEnvironmentVersion(environmentVersion))
  const runtimeConfig = options.runtimeConfig ?? baseEnvironmentSnapshot?.runtimeConfig ?? {}
  const environmentSnapshot = baseEnvironmentSnapshot
  const hostingMode = environmentHostingMode(environmentSnapshot)
  const runtime = options.runtime
  if (
    !(await validateRuntimeProviderModel(
      db,
      auth,
      environmentId,
      hostingMode,
      runtime,
      providerId,
      agentSnapshot.model,
    ))
  ) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        detail: {
          resourceType: 'runtime_catalog',
          runtime,
          hostingMode,
          provider: providerId,
          model: agentSnapshot.model,
        },
      },
    }
  }
  const sandboxId = hostingMode === 'cloud' ? id.toLowerCase() : null
  if (hostingMode === 'cloud') {
    const sandboxDecision = await evaluateSandboxRuntimePolicy(db, auth, {
      session: {
        id,
        agentSnapshot: stringify(agentSnapshot),
        environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
      },
      operation: 'startup',
    })
    if (!sandboxDecision.allowed) {
      await recordAudit(db, {
        auth,
        action: 'session.create',
        resourceType: 'session',
        outcome: 'denied',
        requestId: requestIdFrom(requestId),
        policyCategory: sandboxDecision.category,
        metadata: { agentId, environmentId, decision: sandboxDecision },
      })
      return {
        ok: false,
        error: {
          status: 403,
          code: 'policy_denied',
          message: sandboxDecision.message,
          detail: {
            category: sandboxDecision.category,
            resourceType: 'sandbox',
            resourceId: sandboxId ?? id,
            ruleId: sandboxDecision.rule,
          },
        },
      }
    }
  }
  const pending = {
    id,
    agentId,
    organizationId: auth.organization.id,
    createdByUserId: auth.user.id,
    agentVersionId: agentVersion.id,
    agentSnapshot: stringify(agentSnapshot),
    environmentId,
    environmentVersionId: environmentVersion.id,
    environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
    title: options.title ?? null,
    resourceRefs: stringify(normalizedResources.resourceRefs),
    env: stringify(mergedEnv),
    secretEnv: stringify(mergedSecretEnv),
    projectId: auth.project.id,
    durableObjectName: `org_${auth.organization.id}:project_${auth.project.id}:session_${id}`,
    sandboxId,
    piRuntimeId: null,
    piProcessId: null,
    runtimeEndpointPath: hostingMode === 'cloud' ? runtimeEndpointPath(id) : null,
    modelProvider: providerId,
    modelConfig: stringify({ provider: providerId, ...(agentSnapshot.model ? { model: agentSnapshot.model } : {}) }),
    state: 'pending',
    stateReason: hostingMode === 'self_hosted' ? 'waiting-for-runner' : null,
    metadata: stringify({
      ...(options.metadata ?? {}),
      hostingMode,
      runtime,
      runtimeConfig,
      runtimeDriver: runtimeDriverName(runtime, hostingMode),
      ...(hostingMode === 'self_hosted' ? { runnerState: 'queued', runnerProtocol: 'ama-runner-work' } : {}),
    }),
    startedAt: null,
    stoppedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies SessionRow
  await repo.insertSession(pending)
  await recordAudit(db, {
    auth,
    action: 'session.create',
    resourceType: 'session',
    resourceId: id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: id,
    metadata: { state: pending.state, hostingMode, runtime },
  })

  if (hostingMode === 'self_hosted') {
    await enqueueSelfHostedSessionWork(db, auth, {
      session: pending,
      agentSnapshot,
      environmentSnapshot,
      runtime,
      runtimeConfig,
      resourceRefs: normalizedResources.resourceRefs,
      env: mergedEnv,
      secretEnv: mergedSecretEnv,
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    })
    return { ok: true, session: pending }
  }

  if (!cloudTurnsRunInline(env)) {
    await enqueueCloudTurn(env, {
      type: 'session.start',
      sessionId: pending.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      runtime,
      runtimeConfig,
      resourceRefs: normalizedResources.resourceRefs,
      runtimeEnv: mergedEnv,
      runtimeSecretEnv: mergedSecretEnv,
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    })
    return { ok: true, session: pending }
  }

  await startSessionRuntimeForRow(env, db, auth, {
    pending,
    agentSnapshot,
    environmentSnapshot,
    runtime,
    runtimeConfig,
    resourceRefs: normalizedResources.resourceRefs,
    env: mergedEnv,
    secretEnv: mergedSecretEnv,
    ...(initialPrompt !== undefined ? { initialPrompt } : {}),
  })
  if (env.AMA_RUNTIME_MODE !== 'test') {
    return { ok: true, session: pending }
  }
  const started = await findSession(db, auth, id)
  if (!started) {
    throw new Error('Created session was not persisted')
  }
  return { ok: true, session: started }
}

// ── Prompt dispatch ─────────────────────────────────────────────────────────

export type PromptDispatchOutcome =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: ReturnType<typeof safeRuntimeError> }
  | { ok: true; delivery: MessageDelivery; state: MessageState }

export async function dispatchSessionPrompt(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  content: string,
): Promise<PromptDispatchOutcome> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  if (session.state !== 'idle' && session.state !== 'running') {
    return { ok: false, status: 409, message: 'Session runtime is not active' }
  }
  if (!session.sandboxId) {
    const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    if (
      runtimeSupportsLivePrompts(sessionRuntimeFromMetadata(metadata)) &&
      (await hasAcceptedRunnerSessionChannel(env, session.id))
    ) {
      const delivered = await dispatchRunnerSessionCommand(env, session.id, { type: 'prompt', message: content })
      if (delivered) {
        await recordAudit(db, {
          auth,
          action: 'session.command',
          resourceType: 'session',
          resourceId: session.id,
          outcome: 'success',
          sessionId: session.id,
          metadata: { type: 'prompt', delivery: 'live' },
        })
        return { ok: true, delivery: 'live', state: 'delivered' }
      }
    }
    return await queueSelfHostedSessionPrompt(db, auth, session, content)
  }

  const submittedAt = now()
  const started = await createRuntimeOrchestrationRepo(db).updateSessionWhenState(
    auth.project.id,
    session.id,
    ['idle', 'running'],
    { state: 'running', stateReason: null, updatedAt: submittedAt },
  )
  if (!started) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }

  if (!cloudTurnsRunInline(env)) {
    await enqueueCloudTurn(env, {
      type: 'session.turn',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      prompt: content,
      auditAction: 'session.command',
    })
    return { ok: true, delivery: 'queued', state: 'accepted' }
  }

  const outcome = await executeCloudSessionTurn(env, db, auth, session, { prompt: content }, 'session.command')
  if (!outcome.ok && outcome.cancelled) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  if (!outcome.ok) {
    return { ok: false, status: 500, message: outcome.error.message, runtimeError: outcome.error }
  }
  return { ok: true, delivery: 'live', state: 'delivered' }
}

async function queueSelfHostedSessionPrompt(
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  content: string,
): Promise<PromptDispatchOutcome> {
  const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
  if (!agentSnapshot) {
    return { ok: false, status: 409, message: 'Session agent snapshot is required' }
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof serializeEnvironmentVersion>>(session.environmentSnapshot),
  )
  const submittedAt = now()
  const queued = await createRuntimeOrchestrationRepo(db).updateSessionWhenState(
    auth.project.id,
    session.id,
    ['idle', 'running'],
    { state: 'pending', stateReason: 'waiting-for-runner', updatedAt: submittedAt },
  )
  if (!queued) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  const sessionMetadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
  await enqueueSelfHostedSessionWork(db, auth, {
    session,
    agentSnapshot,
    environmentSnapshot,
    runtime: sessionRuntimeFromMetadata(sessionMetadata),
    runtimeConfig: sessionRuntimeConfig(sessionMetadata),
    resourceRefs: parseJson<ResourceRef[]>(session.resourceRefs) ?? [],
    env: parseJson<Record<string, string>>(session.env) ?? {},
    secretEnv: parseJson<RuntimeSecretEnvEntry[]>(session.secretEnv) ?? [],
    initialPrompt: content,
    resume: true,
    resumeToken: await latestRunnerResumeToken(db, auth, session.id),
  })
  return { ok: true, delivery: 'queued', state: 'accepted' }
}

// ── Stop / archive ──────────────────────────────────────────────────────────

export type StopSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

export async function stopSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
  reason = 'user_requested',
): Promise<StopSessionResult> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  return await stopSessionRow(env, db, auth, session, requestId, reason)
}

async function stopSessionRow(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason = 'user_requested',
): Promise<StopSessionResult> {
  if (session.state === 'stopped') {
    return { ok: true, session }
  }
  if (!session.sandboxId) {
    return await stopSelfHostedSession(env, db, auth, session, requestId, reason)
  }

  const repo = createRuntimeOrchestrationRepo(db)
  const stoppingAt = now()
  await repo.updateSession(auth.project.id, session.id, { state: 'stopped', updatedAt: stoppingAt })

  try {
    await stopCloudSessionRuntime(env, session.sandboxId)
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    await repo.updateSession(auth.project.id, session.id, {
      state: 'error',
      stateReason: safeError.message,
      updatedAt: failedAt,
    })
    await recordAudit(db, {
      auth,
      action: 'session.stop',
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'failure',
      requestId: requestIdFrom(requestId),
      sessionId: session.id,
      metadata: { runtime: safeError },
    })
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session runtime could not be stopped',
        detail: { runtime: safeError },
      },
    }
  }

  const stoppedAt = now()
  await repo.updateSession(auth.project.id, session.id, { state: 'stopped', stoppedAt, updatedAt: stoppedAt })
  await recordAudit(db, {
    auth,
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, sandboxId: session.sandboxId, piRuntimeId: session.piRuntimeId },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: { type: 'session_stop', reason },
    metadata: { source: 'control-plane', sandboxId: session.sandboxId },
  })
  const stopped = await findSession(db, auth, session.id)
  if (!stopped) {
    throw new Error('Stopped session row is required')
  }
  return { ok: true, session: stopped }
}

async function stopSelfHostedSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason: string,
): Promise<StopSessionResult> {
  const repo = createRuntimeOrchestrationRepo(db)
  const stoppedAt = now()
  await dispatchRunnerSessionCommand(env, session.id, { type: 'stop', reason })
  const activeWorkItems = await repo.activeSessionWorkItems(auth.project.id, session.id)

  if (activeWorkItems.length) {
    const workItemIds = activeWorkItems.map((item) => item.id)
    const leaseIds = activeWorkItems.map((item) => item.leaseId).filter((id): id is string => Boolean(id))
    const runnerIds = [
      ...new Set(activeWorkItems.map((item) => item.runnerId).filter((id): id is string => Boolean(id))),
    ]

    await repo.cancelWorkItems(
      auth.project.id,
      workItemIds,
      stringify({ message: `Session stopped: ${reason}` }),
      stoppedAt,
    )

    if (leaseIds.length) {
      await repo.cancelLeases(auth.project.id, leaseIds, stoppedAt)
    }

    for (const runnerId of runnerIds) {
      await repo.decrementRunnerLoad(auth.project.id, runnerId, stoppedAt)
    }
  }

  await repo.updateSession(auth.project.id, session.id, {
    state: 'stopped',
    stateReason: 'runner-cancelled',
    stoppedAt,
    updatedAt: stoppedAt,
  })

  await recordAudit(db, {
    auth,
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, hostingMode: 'self_hosted', cancelledWorkItems: activeWorkItems.length },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: { type: 'session_stop', reason },
    metadata: { source: 'control-plane', hostingMode: 'self_hosted' },
  })

  const stopped = await findSession(db, auth, session.id)
  if (!stopped) {
    throw new Error('Stopped self-hosted session row is required')
  }
  return { ok: true, session: stopped }
}

export async function archiveSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<StopSessionResult> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  if (session.sandboxId && session.state !== 'stopped') {
    const stopped = await stopSessionRow(env, db, auth, session, requestId)
    if (!stopped.ok) {
      return stopped
    }
  }

  const archivedAt = now()
  await createRuntimeOrchestrationRepo(db).updateSession(auth.project.id, session.id, {
    archivedAt,
    updatedAt: archivedAt,
  })
  await recordAudit(db, {
    auth,
    action: 'session.archive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { archivedAt },
  })
  const archived = await findSession(db, auth, session.id)
  if (!archived) {
    throw new Error('Archived session row is required')
  }
  return { ok: true, session: archived }
}

export async function unarchiveSession(
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<SessionRow> {
  const timestamp = now()
  await createRuntimeOrchestrationRepo(db).updateSession(auth.project.id, sessionId, {
    archivedAt: null,
    updatedAt: timestamp,
  })
  await recordAudit(db, {
    auth,
    action: 'session.unarchive',
    resourceType: 'session',
    resourceId: sessionId,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId,
    metadata: {},
  })
  const restored = await findSession(db, auth, sessionId)
  if (!restored) {
    throw new Error('Unarchived session row is required')
  }
  return restored
}

// Mark pending sessions whose cloud runtime startup window elapsed as errored.
export async function markExpiredPendingSessions(db: Db, auth: AuthScope) {
  const expiredBefore = new Date(Date.now() - RUNTIME_START_TIMEOUT_MS).toISOString()
  await createRuntimeOrchestrationRepo(db).markExpiredPendingSessions(auth.project.id, expiredBefore, now())
}

// ── Approval decision continuation ──────────────────────────────────────────

export type ApprovalDecisionResult =
  | { ok: true; approval: ApprovalRowOutput }
  | { ok: false; error: SessionRuntimeError }

export type ApprovalRowOutput = {
  id: string
  organizationId: string
  projectId: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: string
  relatedEventIds: string
  state: 'approved' | 'denied'
  reason: string | null
  result: string | null
  decidedByUserId: string
  decidedAt: string
  requestedAt: string
  createdAt: string
  updatedAt: string
}

export async function decideSessionApproval(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  approvalId: string,
  body: { decision: 'approve' | 'deny'; reason?: string; result?: Record<string, unknown> },
): Promise<ApprovalDecisionResult> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  const repo = createRuntimeOrchestrationRepo(db)
  const { pending } = sessionApprovalState(parseJson<Record<string, unknown>>(session.metadata) ?? {})
  if (!pending) {
    const alreadyDecided = await repo.findApproval(auth.project.id, session.id, approvalId)
    if (alreadyDecided) {
      return { ok: false, error: { status: 409, code: 'conflict', message: 'Approval is already decided' } }
    }
    return { ok: false, error: { status: 404, code: 'not_found', message: 'No pending approval for the session' } }
  }
  if (pending.id !== approvalId) {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Approval is no longer pending' } }
  }

  const approved = body.decision === 'approve'
  const decisionEventId = await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'policy.decision',
      allowed: approved,
      category: 'approval',
      ruleId: 'toolPolicy.requireApprovalTools',
      resourceType: 'tool',
      resourceId: pending.toolName,
      operation: 'tool_approval_decision',
      decision: {
        approvalId: pending.id,
        toolCallId: pending.toolCallId,
        state: approved ? 'approved' : 'denied',
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.result ? { customResult: true } : {}),
      },
    },
    metadata: { source: 'policy', relatedEventIds: pending.relatedEventIds },
  })
  await recordAudit(db, {
    auth,
    action: approved ? 'session.tool_approval_approved' : 'session.tool_approval_denied',
    resourceType: 'tool',
    resourceId: pending.toolName,
    outcome: approved ? 'success' : 'denied',
    sessionId: session.id,
    policyCategory: 'approval',
    metadata: { approvalId: pending.id, toolCallId: pending.toolCallId, decisionEventId },
  })
  await writeSessionApprovalState(db, auth, session.id, (metadata) => {
    const grants = ((metadata.approvalGrants as SessionApprovalGrants | undefined) ?? {}) as SessionApprovalGrants
    const { pendingApproval: _pendingApproval, ...rest } = metadata
    return {
      ...rest,
      approvalGrants: {
        ...grants,
        ...(approved && !body.result ? { approved: { ...grants.approved, [pending.toolCallId]: true } } : {}),
        ...(approved && body.result ? { results: { ...grants.results, [pending.toolCallId]: body.result } } : {}),
        ...(!approved
          ? { denied: { ...grants.denied, [pending.toolCallId]: body.reason ?? 'Tool call denied by the user' } }
          : {}),
      },
    }
  })
  const decidedAt = now()
  const approvalRow: ApprovalRowOutput = {
    id: pending.id,
    organizationId: session.organizationId ?? auth.organization.id,
    projectId: auth.project.id,
    sessionId: session.id,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    input: stringify(pending.input),
    relatedEventIds: stringify(pending.relatedEventIds),
    state: approved ? 'approved' : 'denied',
    reason: body.reason ?? null,
    result: body.result ? stringify(body.result) : null,
    decidedByUserId: auth.user.id,
    decidedAt,
    requestedAt: pending.requestedAt,
    createdAt: decidedAt,
    updatedAt: decidedAt,
  }
  await repo.upsertApproval(approvalRow, decidedAt)
  let resultOutput: Record<string, unknown>
  let resultIsError = false
  if (approved && body.result) {
    resultOutput = body.result
  } else if (approved) {
    const executed = await toolExecutor(env).execute({
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      input: pending.input,
      cwd: '/workspace',
    })
    if (executed.error) {
      resultOutput = executed.error as Record<string, unknown>
      resultIsError = true
    } else {
      resultOutput = executed.output
    }
  } else {
    resultOutput = { denied: true, reason: body.reason ?? 'Tool call denied by the user' }
    resultIsError = true
  }
  const resultText =
    typeof resultOutput.stdout === 'string' || typeof resultOutput.stderr === 'string'
      ? [resultOutput.stdout, resultOutput.stderr]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n')
      : JSON.stringify(resultOutput)
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'tool_execution_end',
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      result: { content: [{ type: 'text', text: resultText }], details: resultOutput },
      isError: resultIsError,
      approval: { id: pending.id, decision: body.decision, ...(body.result ? { custom: true } : {}) },
    },
    metadata: { source: 'approval' },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        content: [{ type: 'text', text: resultText }],
        details: resultOutput,
        isError: resultIsError,
        timestamp: Date.now(),
      },
    },
    metadata: { source: 'approval' },
  })
  await repo.updateSession(auth.project.id, session.id, { state: 'running', stateReason: null, updatedAt: now() })
  const resumed = await findSession(db, auth, session.id)
  if (!resumed) {
    throw new Error('Session row is required after approval decision')
  }
  if (cloudTurnsRunInline(env)) {
    await executeCloudSessionTurn(env, db, auth, resumed, { continuation: true }, 'session.command')
  } else {
    await enqueueCloudTurn(env, {
      type: 'session.step',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      auditAction: 'session.command',
    })
  }
  return { ok: true, approval: approvalRow }
}

export type { PendingSessionApproval }
