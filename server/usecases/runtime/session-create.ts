// Create-session orchestration — deps-first.
//
// This cluster owns building a new session: secret-material guards, resource /
// credential / secret-env validation, provider + policy + runtime-catalog
// checks, snapshot serialization, the 38-field session-row build, and the launch
// path (self-hosted work item, queued cloud turn, or inline cloud startup). It
// also owns the self-hosted work-item enqueue and resume-token lookup, which the
// prompt cluster reuses.
//
// Deps-first: the orchestration store, audit, policy, cloud-turn queue, and
// secret-env gateway all arrive as ports on `deps`; provider/runtime resolution
// and the inline cloud launch run through sibling usecases. The module is
// infra-free — it reaches for ports + domain + shared + runtime leaf shaping +
// sibling usecases only. Logic is verbatim from the former
// server/runtime/session-create module; only dependency acquisition changed.

import type { RuntimeName } from '@server/contracts/environment-contracts'
import { runtimeDriverName, runtimeEndpointPath } from '@server/domain/runtime/driver'
import {
  agentSnapshotWithMemoryStoreContext,
  type GitHubRepositoryResourceRef,
  type NormalizedEnvironmentSnapshot,
  normalizeEnvironmentSnapshot,
  normalizeResourceRefs,
  parseJson,
  type ResourceRef,
  type SerializedAgentVersion,
  serializeAgentVersion,
  serializeEnvironmentVersion,
} from '@server/domain/runtime/session-snapshot'
import { newId, now, requestIdFrom, stringify } from '@server/domain/runtime/util'
import { runtimeRequiredRunnerCapability } from '@server/domain/runtime-catalog'
import { environmentHostingMode } from '@server/domain/runtime-session'
import { composeInitialPrompt, hasSecretMaterial } from '@server/domain/session'
import { safeRuntimeError } from '@server/runtime-error'
import type { AgentRow, AuthScope, CloudTurnSecretEnvEntry, SessionOrchestrationStore, SessionRow } from '../ports'
import type { CloudTurnDeps } from './cloud-turn'
import { startSessionRuntimeForRow } from './cloud-turn'
import { validateRuntimeProviderModel } from './provisioning'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

type SecretEnvEntry = { name: string; credentialRef: { credentialId: string; versionId?: string } }
type ResolvedSecretEnvEntry = { name: string; credentialRef: { credentialId: string; versionId: string } }

// The create flow delegates the inline cloud launch to the cloud-turn usecase,
// so it needs the full CloudTurnDeps. The self-hosted / queued paths use the
// store, audit, policy, queue, and secret-env ports directly.
//
// rereadStartedSession mirrors the legacy AMA_RUNTIME_MODE === 'test' branch: in
// test mode the inline cloud launch ran synchronously so the row is re-read to
// surface the started session; in production the launch is fire-and-forget and
// the pending row is returned as-is.
export type CreateSessionDeps = CloudTurnDeps & { rereadStartedSession: boolean }

type SessionRuntimeError = {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

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

export type CreateSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

async function validateResourceCredentialRefs(
  store: SessionOrchestrationStore,
  auth: AuthScope,
  resourceRefs: ResourceRef[],
) {
  const credentialRefs = resourceRefs
    .filter((resourceRef): resourceRef is GitHubRepositoryResourceRef => resourceRef.type === 'github_repository')
    .map((resourceRef) => resourceRef.credentialRef)
    .filter((credentialRef): credentialRef is { credentialId: string; versionId?: string } => credentialRef != null)
  const seen = new Set<string>()
  for (const credentialRef of credentialRefs) {
    const dedupeKey = `${credentialRef.credentialId}:${credentialRef.versionId ?? ''}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    if (credentialRef.versionId) {
      const exists = await store.activeCredentialVersionExists(
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
    const exists = await store.activeCredentialExists(auth.organization.id, auth.project.id, credentialRef.credentialId)
    if (!exists) {
      return { credentialRef: 'Credential must exist, be active, and belong to this project or organization.' }
    }
  }
  return null
}

async function resolveMemoryStoreResourceRefs(
  store: SessionOrchestrationStore,
  auth: AuthScope,
  resourceRefs: ResourceRef[],
): Promise<{ resourceRefs: ResourceRef[] } | { fields: Record<string, string> }> {
  const resolved: ResourceRef[] = []
  for (const [index, resourceRef] of resourceRefs.entries()) {
    if (resourceRef.type !== 'memory_store') {
      resolved.push(resourceRef)
      continue
    }
    const storeId = typeof resourceRef.storeId === 'string' ? resourceRef.storeId : ''
    const access = resourceRef.access
    if (access !== 'read_only' && access !== 'read_write') {
      return { fields: { [`resourceRefs.${index}.access`]: 'Use read_only or read_write.' } }
    }
    const memoryStore = await store.findActiveMemoryStoreResource(auth.project.id, storeId, access)
    if (!memoryStore) {
      return { fields: { [`resourceRefs.${index}.storeId`]: 'Memory store must exist and be active.' } }
    }
    resolved.push({ ...memoryStore })
  }
  return { resourceRefs: resolved }
}

async function resolveSecretEnvEntries(
  store: SessionOrchestrationStore,
  auth: AuthScope,
  secretEnv: SecretEnvEntry[],
): Promise<{ entries: ResolvedSecretEnvEntry[] } | { fields: Record<string, string> }> {
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
    const credential = await store.activeCredentialForSecretEnv(
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
    if (!(await store.activeVersionForCredentialExists(credential.id, versionId))) {
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

async function currentAgentVersion(store: SessionOrchestrationStore, agent: AgentRow) {
  if (!agent.currentVersionId) {
    return null
  }
  return store.findAgentVersion(agent.id, agent.currentVersionId)
}

async function sessionInitialPrompt(
  store: SessionOrchestrationStore,
  projectId: string,
  agent: AgentRow,
  initialPrompt: string | undefined,
) {
  const memoryPolicy = parseJson<Record<string, unknown>>(agent.memoryPolicy) ?? {}
  if (memoryPolicy.enabled !== true) {
    return initialPrompt
  }
  const content = await store.agentMemoryContent(projectId, agent.id)
  return composeInitialPrompt(content, initialPrompt)
}

// ── Work item enqueue ───────────────────────────────────────────────────────

export async function enqueueSelfHostedSessionWork(
  deps: Pick<CreateSessionDeps, 'sessionOrchestration'>,
  auth: AuthScope,
  values: {
    session: SessionRow
    agentSnapshot: SerializedAgentVersion
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs?: ResourceRef[]
    env?: Record<string, string>
    secretEnv?: CloudTurnSecretEnvEntry[]
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
  await deps.sessionOrchestration.insertWorkItem({
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
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export async function latestRunnerResumeToken(
  deps: Pick<CreateSessionDeps, 'sessionOrchestration'>,
  auth: AuthScope,
  sessionId: string,
) {
  const rows = await deps.sessionOrchestration.recentSessionWorkItems(auth.project.id, sessionId, 5)
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
  deps: CreateSessionDeps,
  auth: AuthScope,
  agentId: string,
  requestedEnvironmentId: string | null,
  options: CreateSessionOptions,
  requestId: string | null,
): Promise<CreateSessionResult> {
  const store = deps.sessionOrchestration
  const audit = deps.audit
  const policy = deps.policy
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

  const agent = await store.findAgent(auth.project.id, agentId)
  if (!agent) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Agent not found' } }
  }
  if (agent.archivedAt) {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Archived agents cannot create sessions' } }
  }

  const agentVersion = await currentAgentVersion(store, agent)
  if (!agentVersion) {
    throw new Error('Agent current version is required')
  }
  if (!agentVersion.providerId) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Agent must pin a provider before a session can be created',
        detail: { resourceType: 'provider', resourceId: agentId },
      },
    }
  }
  const providerId = agentVersion.providerId
  const initialPrompt = await sessionInitialPrompt(store, auth.project.id, agent, options.initialPrompt)
  const { decision: policyDecision, override: policyOverride } = await policy.evaluateProviderForSession(auth, {
    providerId,
    modelId: agentVersion.model,
    adminOverride: options.providerAccessOverride === true,
  })
  if (!policyDecision.allowed) {
    await audit.record(auth, {
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
    await audit.record(auth, {
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

  // Resolve an environment when the caller didn't pin one: pick one whose
  // active runner can serve this runtime/model. Cloud runtimes have no runner,
  // so they resolve to nothing and must pin an environment explicitly.
  const environmentId =
    requestedEnvironmentId ??
    (await store.resolveEnvironmentForRuntime(auth.project.id, options.runtime, providerId, agentVersion.model))
  if (!environmentId) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: `No environment has an active runner for runtime "${options.runtime}"; specify environmentId`,
      },
    }
  }

  const environment = await store.findEnvironment(auth.project.id, environmentId)
  if (!environment?.currentVersionId) {
    return {
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Selected environment is archived or unavailable' },
    }
  }
  const environmentVersion = await store.findEnvironmentVersion(auth.project.id, environment.currentVersionId)
  if (!environmentVersion) {
    return {
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Selected environment is archived or unavailable' },
    }
  }
  const credentialError = await validateResourceCredentialRefs(store, auth, normalizedResources.resourceRefs)
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
  const resolvedResources = await resolveMemoryStoreResourceRefs(store, auth, normalizedResources.resourceRefs)
  if ('fields' in resolvedResources) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Invalid session memory store reference',
        fields: resolvedResources.fields,
      },
    }
  }
  const resolvedSecretEnv = await resolveSecretEnvEntries(store, auth, options.secretEnv ?? [])
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

  const mergedEnv = options.env ?? {}
  const mergedSecretEnv = resolvedSecretEnv.entries

  const timestamp = now()
  const id = crypto.randomUUID()
  const agentSnapshot = serializeAgentVersion(agentVersion, providerId)
  const runtimeAgentSnapshot = agentSnapshotWithMemoryStoreContext(agentSnapshot, resolvedResources.resourceRefs)
  const baseEnvironmentSnapshot = normalizeEnvironmentSnapshot(serializeEnvironmentVersion(environmentVersion))
  const runtimeConfig = options.runtimeConfig ?? baseEnvironmentSnapshot?.runtimeConfig ?? {}
  const environmentSnapshot = baseEnvironmentSnapshot
  const hostingMode = environmentHostingMode(environmentSnapshot)
  const runtime = options.runtime
  if (
    !(await validateRuntimeProviderModel(
      deps,
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
    const sandboxDecision = await policy.evaluateSandboxRuntime(auth, {
      session: {
        id,
        agentSnapshot: stringify(agentSnapshot),
        environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
      },
      operation: 'startup',
      command: null,
      host: null,
    })
    if (!sandboxDecision.allowed) {
      await audit.record(auth, {
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
    resourceRefs: stringify(resolvedResources.resourceRefs),
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
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    continuationDepth: 0,
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
  await store.insertSession(pending)
  await audit.record(auth, {
    action: 'session.create',
    resourceType: 'session',
    resourceId: id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: id,
    metadata: { state: pending.state, hostingMode, runtime },
  })

  try {
    if (hostingMode === 'self_hosted') {
      await enqueueSelfHostedSessionWork(deps, auth, {
        session: pending,
        agentSnapshot: runtimeAgentSnapshot,
        environmentSnapshot,
        runtime,
        runtimeConfig,
        resourceRefs: resolvedResources.resourceRefs,
        env: mergedEnv,
        secretEnv: mergedSecretEnv,
        ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      })
      return { ok: true, session: pending }
    }

    if (!deps.cloudTurnQueue.runsInline()) {
      await deps.cloudTurnQueue.enqueue({
        type: 'session.start',
        sessionId: pending.id,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        runtime,
        runtimeConfig,
        resourceRefs: resolvedResources.resourceRefs,
        runtimeEnv: mergedEnv,
        runtimeSecretEnv: mergedSecretEnv,
        ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      })
      return { ok: true, session: pending }
    }

    await startSessionRuntimeForRow(deps, auth, {
      pending,
      agentSnapshot,
      environmentSnapshot,
      runtime,
      runtimeConfig,
      resourceRefs: resolvedResources.resourceRefs,
      env: mergedEnv,
      secretEnv: mergedSecretEnv,
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    })
    if (!deps.rereadStartedSession) {
      return { ok: true, session: pending }
    }
    const started = await store.findSession(auth.project.id, id)
    if (!started) {
      throw new Error('Created session was not persisted')
    }
    return { ok: true, session: started }
  } catch (error) {
    // The row is persisted as 'pending' but the launch step failed (e.g. the
    // queue send threw). Reconcile the orphaned row to 'error' so it is not
    // stranded until the expiry sweep, then report the failure.
    const safeError = safeRuntimeError(error)
    await store.updateSessionWhenState(auth.project.id, id, 'pending', {
      state: 'error',
      stateReason: safeError.message,
      updatedAt: now(),
    })
    await audit.record(auth, {
      action: 'session.create',
      resourceType: 'session',
      resourceId: id,
      outcome: 'failure',
      requestId: requestIdFrom(requestId),
      sessionId: id,
      metadata: { ...safeError },
    })
    return { ok: false, error: { status: 500, code: 'session_launch_failed', message: safeError.message } }
  }
}
