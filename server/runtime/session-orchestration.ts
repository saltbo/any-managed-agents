// Runtime execution layer for sessions.
//
// This module owns the env-bound session machinery: the create-session
// orchestration (snapshot, provider/policy/runtime validation, session-row
// build, runtime launch), the cloud turn loop and its queue consumer, prompt
// dispatch (live channel vs queued), stop/archive runtime teardown, and the
// approval-decision continuation. It sits in server/runtime/ alongside the
// other runtime execution infrastructure (drivers, sandbox/DO bindings, the
// turn queue) and is consumed by the SessionRuntimeGateway adapter, the queue
// consumer (workers/bootstrap), and the scheduler dispatcher.
//
// Every public entry here is Response-free: HTTP concerns (Response, status
// codes, SSE) stay in server/http/sessions.ts. Outcomes cross the boundary as
// discriminated result objects.

import {
  runnerSupportsRuntimeProviderModel,
  runtimeCatalogSupportsProviderModel,
  runtimeRequiredRunnerCapability,
  runtimeSupportsLivePrompts,
} from '@server/domain/runtime-catalog'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import { recordAudit } from '../audit'
import type { AuthContext } from '../auth/session'
import {
  agentMemories,
  agents,
  agentVersions,
  connections,
  connectionTools,
  environments,
  environmentVersions,
  leases,
  providers as providersTable,
  runners,
  sessionApprovals,
  sessionEvents,
  sessions,
  vaultCredentials,
  vaultCredentialVersions,
  workItems,
} from '../db/schema'
import { insertCanonicalSessionEvent } from '../db/session-event-store'
import {
  composeInitialPrompt,
  hasEmbeddedCredentialUrl,
  hasSecretMaterial,
  normalizeMountPath,
} from '../domain/session'
import type { Env } from '../env'
import {
  evaluateMcpToolPolicy,
  evaluateProviderPolicyForSession,
  evaluateSandboxRuntimePolicy,
  policyBlocksSandboxOperation,
} from '../policy'
import type { RuntimeName } from '../routes/environment-contracts'
import { runtimeDriver, runtimeDriverName } from './drivers'
import { PLATFORM_DEFAULT_PROVIDER, providerRuntimeEnv, resolveSessionProviderConfig } from './provider-env'
import { dispatchRunnerSessionCommand, hasAcceptedRunnerSessionChannel } from './runner-session-command'
import { safeRuntimeError } from './runtime-error'
import { type RuntimeSecretEnvEntry, resolveRuntimeSecretEnv } from './secret-env'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  RuntimeTurnCancelledError,
  runSessionTurn,
  runtimeEndpointPath,
  runtimeMessagesFromEvents,
  stopSessionRuntime as stopCloudSessionRuntime,
} from './session-runtime'
import {
  createToolApprovalGate,
  type PendingSessionApproval,
  type SessionApprovalGrants,
  sessionApprovalState,
  writeSessionApprovalState,
} from './tool-approvals'
import { toolExecutor } from './tool-executor'
import { type CloudTurnMessage, cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'

type Db = ReturnType<typeof drizzle>
type AgentRow = typeof agents.$inferSelect
type AgentVersionRow = typeof agentVersions.$inferSelect
type EnvironmentVersionRow = typeof environmentVersions.$inferSelect
type SessionRow = typeof sessions.$inferSelect

type MessageDelivery = 'live' | 'queued'
type MessageState = 'accepted' | 'delivered' | 'failed'

const RUNTIME_START_TIMEOUT_MS = 300_000
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
// Per-invocation soft budget for new model turns (see executeCloudSessionTurn).
const CLOUD_TURN_SOFT_BUDGET_MS = 4 * 60_000

export type ResourceRef = Record<string, unknown>
export type GitHubRepositoryResourceRef = {
  type: 'github_repository'
  owner: string
  repo: string
  ref?: string
  mountPath?: string
  credentialRef?: string
}
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

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function requestIdFrom(requestId: string | null | undefined) {
  return requestId ?? null
}

// ── Snapshot helpers ────────────────────────────────────────────────────────

function serializeAgentVersion(row: AgentVersionRow, providerId: string) {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    instructions: row.instructions,
    providerId,
    model: row.model,
    skills: JSON.parse(row.skills) as string[],
    subagents: JSON.parse(row.subagents) as Record<string, unknown>[],
    role: row.role,
    capabilityTags: JSON.parse(row.capabilityTags) as string[],
    handoffPolicy: JSON.parse(row.handoffPolicy) as Record<string, unknown>,
    memoryPolicy: JSON.parse(row.memoryPolicy) as Record<string, unknown>,
    tools: JSON.parse(row.tools) as Record<string, unknown>[],
    mcpConnectors: JSON.parse(row.mcpConnectors) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

export type SerializedAgentVersion = ReturnType<typeof serializeAgentVersion>

function parseAgentSnapshot(value: string | null) {
  return parseJson<SerializedAgentVersion>(value)
}

function serializeEnvironmentVersion(row: EnvironmentVersionRow) {
  return {
    ...row,
    packages: JSON.parse(row.packages) as Record<string, unknown>[],
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    credentialRefs: JSON.parse(row.credentialRefs) as Record<string, unknown>[],
    hostingMode: row.hostingMode,
    networkPolicy: JSON.parse(row.networkPolicy) as Record<string, unknown>,
    mcpPolicy: JSON.parse(row.mcpPolicy) as Record<string, unknown>,
    packageManagerPolicy: JSON.parse(row.packageManagerPolicy) as Record<string, unknown>,
    resourceLimits: JSON.parse(row.resourceLimits) as Record<string, unknown>,
    runtimeConfig: JSON.parse(row.runtimeConfig) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  }
}

type NormalizedEnvironmentSnapshot = ReturnType<typeof serializeEnvironmentVersion>

function normalizeEnvironmentSnapshot(
  snapshot: ReturnType<typeof serializeEnvironmentVersion> | Record<string, unknown> | null,
): NormalizedEnvironmentSnapshot | null {
  if (!snapshot) {
    return null
  }
  const snapshotRecord = snapshot as Record<string, unknown>
  return {
    ...snapshotRecord,
    hostingMode: snapshotRecord.hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud',
    networkPolicy: objectValue(snapshotRecord.networkPolicy),
    runtimeConfig: objectValue(snapshotRecord.runtimeConfig),
  } as NormalizedEnvironmentSnapshot
}

function environmentHostingMode(snapshot: NormalizedEnvironmentSnapshot | null) {
  return snapshot?.hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud'
}

function sessionRuntimeFromMetadata(metadata: Record<string, unknown>): RuntimeName {
  const runtime = metadata.runtime
  if (typeof runtime !== 'string') {
    throw new Error('Session runtime metadata is required')
  }
  return runtime as RuntimeName
}

function sessionRuntimeConfig(metadata: Record<string, unknown>) {
  return objectValue(metadata.runtimeConfig)
}

function sessionModel(modelConfig: Record<string, unknown>, agentSnapshot: SerializedAgentVersion) {
  return typeof modelConfig.model === 'string'
    ? modelConfig.model
    : typeof agentSnapshot.model === 'string'
      ? agentSnapshot.model
      : null
}

// ── Resource ref + secret env resolution ────────────────────────────────────

function normalizeResourceRefs(resourceRefs: ResourceRef[]) {
  const normalized: ResourceRef[] = []
  const mountPaths = new Set<string>()
  for (const [index, resourceRef] of resourceRefs.entries()) {
    if (hasEmbeddedCredentialUrl(resourceRef)) {
      return { fields: { [`resourceRefs.${index}`]: 'URLs with embedded credentials are not allowed.' } }
    }
    if (resourceRef.type !== 'github_repository') {
      normalized.push(resourceRef)
      continue
    }
    const parsed = resourceRef as GitHubRepositoryResourceRef
    let mountPath: string
    try {
      mountPath = normalizeMountPath(parsed)
    } catch (error) {
      return { fields: { [`resourceRefs.${index}.mountPath`]: error instanceof Error ? error.message : String(error) } }
    }
    if (mountPaths.has(mountPath)) {
      return { fields: { [`resourceRefs.${index}.mountPath`]: 'Mount path must be unique within a session.' } }
    }
    mountPaths.add(mountPath)
    normalized.push({
      type: 'github_repository',
      owner: parsed.owner,
      repo: parsed.repo,
      mountPath,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...(parsed.credentialRef ? { credentialRef: parsed.credentialRef } : {}),
    })
  }
  return { resourceRefs: normalized }
}

async function validateResourceCredentialRefs(db: Db, auth: AuthContext, resourceRefs: ResourceRef[]) {
  const credentialRefs = resourceRefs
    .filter((resourceRef): resourceRef is GitHubRepositoryResourceRef => resourceRef.type === 'github_repository')
    .map((resourceRef) => resourceRef.credentialRef)
    .filter((credentialRef): credentialRef is string => typeof credentialRef === 'string')
  for (const credentialRef of new Set(credentialRefs)) {
    if (credentialRef.startsWith('vaultver_')) {
      const version = await db
        .select({ id: vaultCredentialVersions.id })
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, credentialRef),
            eq(vaultCredentialVersions.organizationId, auth.organization.id),
            or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
            eq(vaultCredentialVersions.state, 'active'),
          ),
        )
        .get()
      if (!version) {
        return {
          credentialRef: 'Credential version must exist, be active, and belong to this project or organization.',
        }
      }
      continue
    }
    const credential = await db
      .select({ id: vaultCredentials.id })
      .from(vaultCredentials)
      .where(
        and(
          eq(vaultCredentials.id, credentialRef),
          eq(vaultCredentials.organizationId, auth.organization.id),
          or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
          eq(vaultCredentials.state, 'active'),
        ),
      )
      .get()
    if (!credential) {
      return { credentialRef: 'Credential must exist, be active, and belong to this project or organization.' }
    }
  }
  return null
}

async function resolveSecretEnvEntries(
  db: Db,
  auth: AuthContext,
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
    const credential = await db
      .select({ id: vaultCredentials.id, activeVersionId: vaultCredentials.activeVersionId })
      .from(vaultCredentials)
      .where(
        and(
          eq(vaultCredentials.id, entry.credentialRef.credentialId),
          eq(vaultCredentials.organizationId, auth.organization.id),
          or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
          eq(vaultCredentials.state, 'active'),
        ),
      )
      .get()
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
    const version = await db
      .select({ id: vaultCredentialVersions.id })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, versionId),
          eq(vaultCredentialVersions.credentialId, credential.id),
          eq(vaultCredentialVersions.state, 'active'),
        ),
      )
      .get()
    if (!version) {
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

async function findSession(db: Db, auth: AuthContext, sessionId: string) {
  return (
    (await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id)))
      .get()) ?? null
  )
}

async function currentAgentVersion(db: Db, agent: AgentRow) {
  if (!agent.currentVersionId) {
    return null
  }
  return (
    (await db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.id, agent.currentVersionId), eq(agentVersions.agentId, agent.id)))
      .get()) ?? null
  )
}

async function sessionInitialPrompt(db: Db, projectId: string, agent: AgentRow, initialPrompt: string | undefined) {
  const memoryPolicy = parseJson<Record<string, unknown>>(agent.memoryPolicy) ?? {}
  if (memoryPolicy.enabled !== true) {
    return initialPrompt
  }
  const memory = await db
    .select({ content: agentMemories.content })
    .from(agentMemories)
    .where(and(eq(agentMemories.agentId, agent.id), eq(agentMemories.projectId, projectId)))
    .get()
  return composeInitialPrompt(memory?.content ?? null, initialPrompt)
}

async function resolveSessionProviderId(db: Db, projectId: string, providerId: string | null) {
  if (!providerId) {
    const configuredDefault = await db
      .select({ id: providersTable.id, type: providersTable.type })
      .from(providersTable)
      .where(
        and(
          eq(providersTable.projectId, projectId),
          eq(providersTable.isDefault, true),
          eq(providersTable.enabled, true),
        ),
      )
      .get()
    if (!configuredDefault) {
      return PLATFORM_DEFAULT_PROVIDER
    }
    return configuredDefault.type === PLATFORM_DEFAULT_PROVIDER ? PLATFORM_DEFAULT_PROVIDER : configuredDefault.id
  }
  if (providerId === PLATFORM_DEFAULT_PROVIDER) {
    return PLATFORM_DEFAULT_PROVIDER
  }
  const configured = await db
    .select({ type: providersTable.type })
    .from(providersTable)
    .where(and(eq(providersTable.id, providerId), eq(providersTable.projectId, projectId)))
    .get()
  return configured?.type === PLATFORM_DEFAULT_PROVIDER ? PLATFORM_DEFAULT_PROVIDER : providerId
}

async function validateRuntimeProviderModel(
  db: Db,
  auth: AuthContext,
  environmentId: string,
  hostingMode: 'cloud' | 'self_hosted',
  runtime: RuntimeName,
  provider: string,
  model: string | null,
) {
  const driver = runtimeDriver(runtime)
  if (!driver.supportsHostingMode(hostingMode)) {
    return false
  }
  if (hostingMode === 'self_hosted') {
    if (!runtimeCatalogSupportsProviderModel(hostingMode, runtime, provider, model)) {
      return false
    }
    const activeRunners = await db
      .select({ capabilities: runners.capabilities })
      .from(runners)
      .where(
        and(
          eq(runners.projectId, auth.project.id),
          eq(runners.environmentId, environmentId),
          eq(runners.state, 'active'),
        ),
      )
    return (
      activeRunners.some((runner) =>
        runnerSupportsRuntimeProviderModel(parseJson<string[]>(runner.capabilities) ?? [], runtime, provider, model),
      ) || activeRunners.length === 0
    )
  }
  return driver.supportsCloudProviderModel(provider, model)
}

function mcpConnectorIds(snapshot: Record<string, unknown>) {
  const connectors = Array.isArray(snapshot.connectors) ? snapshot.connectors : []
  return connectors
    .map((connector) =>
      connector && typeof connector === 'object' && 'connectorId' in connector
        ? (connector.connectorId as unknown)
        : null,
    )
    .filter((connectorId): connectorId is string => typeof connectorId === 'string')
}

async function resolveMcpSnapshot(
  db: Db,
  auth: AuthContext,
  sessionId: string,
  agentSnapshot: SerializedAgentVersion,
  environmentSnapshot: NormalizedEnvironmentSnapshot | null,
) {
  const connectedConnections = await db
    .select()
    .from(connections)
    .where(and(eq(connections.projectId, auth.project.id), eq(connections.state, 'connected')))
  const agentConnectors = agentSnapshot.mcpConnectors
  const scopedConnections =
    agentConnectors.length === 0
      ? connectedConnections
      : connectedConnections.filter((connection) => agentConnectors.includes(connection.connectorId))

  const snapshotConnections = []
  const sessionContext = {
    id: sessionId,
    agentSnapshot: stringify(agentSnapshot),
    environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
  }
  for (const connection of scopedConnections) {
    const tools = await db
      .select()
      .from(connectionTools)
      .where(and(eq(connectionTools.connectionId, connection.id), eq(connectionTools.availability, 'available')))
    const allowedTools = []
    for (const tool of tools) {
      const decision = await evaluateMcpToolPolicy(db, auth, {
        connectorId: connection.connectorId,
        toolName: tool.name,
        session: sessionContext,
      })
      if (decision.allowed) {
        allowedTools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: parseJson<Record<string, unknown>>(tool.inputSchema) ?? {},
          approvalMode: tool.approvalMode,
          policyMetadata: parseJson<Record<string, unknown>>(tool.policyMetadata) ?? {},
        })
      }
    }
    if (allowedTools.length > 0) {
      snapshotConnections.push({
        connectionId: connection.id,
        connectorId: connection.connectorId,
        endpointUrl: connection.endpointUrl,
        approvalMode: connection.approvalMode,
        credentialRef: connection.credentialVersionId ?? connection.credentialId,
        tools: allowedTools,
      })
    }
  }
  return { connectors: snapshotConnections }
}

// ── Work item enqueue ───────────────────────────────────────────────────────

async function enqueueSelfHostedSessionWork(
  db: Db,
  auth: AuthContext,
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
  await db.insert(workItems).values({
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

async function latestRunnerResumeToken(db: Db, auth: AuthContext, sessionId: string) {
  const rows = await db
    .select({ state: workItems.state, payload: workItems.payload, result: workItems.result })
    .from(workItems)
    .where(and(eq(workItems.projectId, auth.project.id), eq(workItems.sessionId, sessionId)))
    .orderBy(desc(workItems.updatedAt))
    .limit(5)
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
  auth: AuthContext,
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

  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.projectId, auth.project.id)))
    .get()
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

  const environment = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.id, environmentId),
        eq(environments.projectId, auth.project.id),
        isNull(environments.archivedAt),
      ),
    )
    .get()
  if (!environment?.currentVersionId) {
    return {
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Selected environment is archived or unavailable' },
    }
  }
  const environmentVersion =
    (await db
      .select()
      .from(environmentVersions)
      .where(
        and(
          eq(environmentVersions.id, environment.currentVersionId),
          eq(environmentVersions.projectId, auth.project.id),
        ),
      )
      .get()) ?? null
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
  await db.insert(sessions).values(pending)
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

async function startSessionRuntimeForRow(
  env: Env,
  db: Db,
  auth: AuthContext,
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
  const { pending, agentSnapshot, environmentSnapshot, runtime, runtimeConfig, resourceRefs, initialPrompt } = input
  const sessionEnv = input.env
  const sessionSecretEnv = input.secretEnv ?? []
  const sessionId = pending.id
  const sandboxId = pending.sandboxId ?? sessionId.toLowerCase()
  const runtimeName = runtime
  const driver = runtimeDriver(runtimeName)
  if (!driver.startCloudSession) {
    throw new Error(`Runtime ${runtimeName} does not support cloud session startup`)
  }
  try {
    const mcpSnapshot = await resolveMcpSnapshot(db, auth, sessionId, agentSnapshot, environmentSnapshot)
    const runtimeEnvironmentSnapshot = environmentSnapshot ? { ...environmentSnapshot, runtimeConfig } : null
    const resolvedSecretEnv = await resolveRuntimeSecretEnv(
      env,
      db,
      { organizationId: auth.organization.id, projectId: auth.project.id },
      sessionSecretEnv,
    )
    const startedRuntime = await withTimeout(
      driver.startCloudSession(env, {
        sessionId,
        sandboxId,
        runtime: runtimeName,
        provider: agentSnapshot.providerId,
        model: agentSnapshot.model,
        agentSnapshot,
        environmentSnapshot: runtimeEnvironmentSnapshot,
        mcpSnapshot,
        resourceRefs,
        runtimeEnv: sessionEnv ?? {},
        runtimeSecretEnv: sessionSecretEnv,
        resolvedSecretEnv,
      }),
      RUNTIME_START_TIMEOUT_MS,
      'Session runtime startup timed out',
    )
    const current = await findSession(db, auth, sessionId)
    if (current?.state !== 'pending') {
      if (current?.state !== 'idle') {
        await stopCloudSessionRuntime(env, sandboxId).catch(() => undefined)
      }
      return
    }
    const startedAt = now()
    const existingMetadata = parseJson<Record<string, unknown>>(pending.metadata) ?? {}
    const metadata = {
      ...existingMetadata,
      ...startedRuntime.metadata,
      runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
      runtimeBackend: driver.cloudBackend,
      runtimeProtocol: driver.cloudProtocol,
      mcpConnectors: mcpConnectorIds(mcpSnapshot),
    }
    const started = {
      sandboxId,
      piRuntimeId: null,
      piProcessId: null,
      runtimeEndpointPath: startedRuntime.runtimeEndpointPath,
      state: 'idle',
      metadata: stringify(metadata),
      startedAt,
      updatedAt: startedAt,
    }
    await db
      .update(sessions)
      .set(started)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'pending')))
    await recordAudit(db, {
      auth,
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'success',
      sessionId,
      metadata: { sandboxId: startedRuntime.sandboxId, runtimeEndpointPath: startedRuntime.runtimeEndpointPath },
    })
    if (initialPrompt) {
      await dispatchInitialPrompt(
        env,
        db,
        auth,
        { ...pending, ...started, stateReason: null, stoppedAt: null, archivedAt: null },
        initialPrompt,
      )
    }
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    const failed = {
      state: 'error',
      stateReason: safeError.message,
      metadata: stringify({
        ...(parseJson<Record<string, unknown>>(pending.metadata) ?? {}),
        runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
        runtimeBackend: driver.cloudBackend,
        error: safeError,
      }),
      updatedAt: failedAt,
    }
    await db
      .update(sessions)
      .set(failed)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'pending')))
    await recordAudit(db, {
      auth,
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'failure',
      sessionId,
      metadata: { ...safeError },
    })
    await stopCloudSessionRuntime(env, sandboxId).catch(() => undefined)
  }
}

// ── Cloud turn execution + queue consumer ───────────────────────────────────

type CloudTurnOutcome =
  | { ok: true; requiresAction?: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ReturnType<typeof safeRuntimeError> }

async function executeCloudSessionTurn(
  env: Env,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.initial_prompt' | 'session.command',
): Promise<CloudTurnOutcome> {
  let approvalGateRef: ReturnType<typeof createToolApprovalGate> | null = null
  let policyDeniedToolCall = false
  try {
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required')
    }
    const modelConfig = parseJson<Record<string, unknown>>(session.modelConfig) ?? {}
    const messages = await loadRuntimeMessages(db, session.id)
    const ensureActive = async () => {
      await assertRuntimeSessionRunning(db, auth, session.id)
    }
    const sessionMetadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    const approvalGate = createToolApprovalGate({
      db,
      auth,
      sessionId: session.id,
      sessionMetadata,
      appendEvent: (event, metadata) => appendRuntimeEvent(db, { auth, sessionId: session.id, event, metadata }),
    })
    approvalGateRef = approvalGate
    const startedAt = Date.now()
    const result = await runSessionTurn(env, {
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      provider: session.modelProvider ?? agentSnapshot.providerId,
      model: sessionModel(modelConfig, agentSnapshot),
      agentSnapshot,
      ...(work.prompt !== undefined ? { prompt: work.prompt } : {}),
      ...(work.continuation ? { continuation: true } : {}),
      messages,
      ...(cloudTurnsRunInline(env) ? {} : { shouldPause: () => Date.now() - startedAt > CLOUD_TURN_SOFT_BUDGET_MS }),
      ensureActive,
      onEvent: async (event, metadata) => {
        if (approvalGate.shouldSuppressEvent(event)) {
          return
        }
        await ensureActive()
        await appendRuntimeEvent(db, { auth, sessionId: session.id, event, ...(metadata ? { metadata } : {}) })
      },
      resolveToolResult: (input) => approvalGate.resolveToolResult(input),
      approveToolCall: async ({ toolCallId, toolName, input }) => {
        await ensureActive()
        const blocked = await policyBlocksSandboxOperation(db, auth, {
          session: {
            id: session.id,
            agentSnapshot: session.agentSnapshot,
            environmentSnapshot: session.environmentSnapshot,
          },
          toolName,
          input,
        })
        if (blocked) {
          const operationFields =
            blocked.operation.operation === 'command'
              ? { command: blocked.operation.command }
              : { host: blocked.operation.host }
          await ensureActive()
          await appendRuntimeEvent(db, {
            auth,
            sessionId: session.id,
            event: {
              type: 'policy_denied',
              category: blocked.decision.category,
              ruleId: blocked.decision.rule,
              resourceType: blocked.operation.resourceType,
              resourceId: blocked.operation.resourceId,
              decision: blocked.decision,
              operation: blocked.operation.operation,
              ...operationFields,
            },
            metadata: { source: 'policy' },
          })
          await recordAudit(db, {
            auth,
            action: 'runtime_sandbox.operation',
            resourceType: blocked.operation.resourceType,
            resourceId: blocked.operation.resourceId,
            outcome: 'denied',
            sessionId: session.id,
            policyCategory: blocked.decision.category,
            metadata: { operation: blocked.operation.operation, ...operationFields, decision: blocked.decision },
          })
          await ensureActive()
          policyDeniedToolCall = true
          return { allowed: false, reason: blocked.decision.message }
        }
        const approvalDecision = await approvalGate.gate({ toolCallId, toolName, input })
        if (approvalDecision) {
          return approvalDecision
        }
        return { allowed: true }
      },
    })
    if (result.status === 'idle') {
      await db
        .update(sessions)
        .set({ state: 'idle', updatedAt: now() })
        .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'running')))
    }

    if (result.status === 'paused') {
      await db
        .update(sessions)
        .set({ updatedAt: now() })
        .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'running')))
      await enqueueCloudTurn(env, {
        type: 'session.step',
        sessionId: session.id,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        auditAction,
      })
      return { ok: true }
    }

    await recordAudit(db, {
      auth,
      action: auditAction,
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'success',
      sessionId: session.id,
      metadata:
        auditAction === 'session.initial_prompt' ? { source: 'api', promptDispatched: true } : { type: 'prompt' },
    })
    return { ok: true }
  } catch (error) {
    if (isRuntimeTurnCancelled(error)) {
      if (approvalGateRef?.requiresAction()) {
        return { ok: true, requiresAction: true }
      }
      return { ok: false, cancelled: true }
    }
    const safeError = safeRuntimeError(error)
    if (policyDeniedToolCall || isRuntimePolicyDenied(error)) {
      await db
        .update(sessions)
        .set({ state: 'idle', stateReason: 'policy-denied', updatedAt: now() })
        .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'running')))
      return { ok: false, cancelled: false, error: safeError }
    }
    await markInitialPromptFailed(db, auth, session, safeError.message)
    return { ok: false, cancelled: false, error: safeError }
  }
}

export async function consumeCloudTurnMessage(env: Env, message: CloudTurnMessage): Promise<void> {
  const db = drizzle(env.DB)
  const auth = cloudTurnSystemAuth(message)
  const session = await findSession(db, auth, message.sessionId)
  if (!session) {
    return
  }
  if (message.type === 'session.start') {
    if (session.state !== 'pending') {
      return
    }
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required for cloud startup')
    }
    await startSessionRuntimeForRow(env, db, auth, {
      pending: session,
      agentSnapshot,
      environmentSnapshot: parseJson<NormalizedEnvironmentSnapshot>(session.environmentSnapshot),
      runtime: message.runtime as RuntimeName,
      runtimeConfig: message.runtimeConfig,
      resourceRefs: message.resourceRefs,
      env: message.runtimeEnv,
      secretEnv: message.runtimeSecretEnv,
      ...(message.initialPrompt !== undefined ? { initialPrompt: message.initialPrompt } : {}),
    })
    return
  }
  if (message.type === 'session.step') {
    if (session.state !== 'running') {
      return
    }
    await executeCloudSessionTurn(env, db, auth, session, { continuation: true }, message.auditAction)
    return
  }
  if (session.state === 'idle') {
    const reclaimed = await db
      .update(sessions)
      .set({ state: 'running', stateReason: null, updatedAt: now() })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'idle')))
      .returning({ id: sessions.id })
      .get()
    if (!reclaimed) {
      return
    }
  } else if (session.state !== 'running') {
    return
  }
  await executeCloudSessionTurn(env, db, auth, session, { prompt: message.prompt }, message.auditAction)
}

function cloudTurnSystemAuth(message: CloudTurnMessage): AuthContext {
  return {
    user: { id: 'system:cloud-turn', email: '', name: 'AMA cloud turn runner', avatarUrl: null },
    organization: { id: message.organizationId, name: message.organizationId },
    project: { id: message.projectId, name: message.projectId },
    roles: ['system'],
    permissions: ['*'],
    oidc: {
      subject: 'system:cloud-turn',
      clientId: null,
      scope: null,
      issuer: null,
      externalTenantId: null,
      runnerId: null,
      runnerProjectId: null,
      runnerEnvironmentId: null,
    },
  }
}

async function dispatchInitialPrompt(env: Env, db: Db, auth: AuthContext, session: SessionRow, initialPrompt: string) {
  const submittedAt = now()
  const started = await db
    .update(sessions)
    .set({ state: 'running', stateReason: null, updatedAt: submittedAt })
    .where(
      and(
        eq(sessions.id, session.id),
        eq(sessions.projectId, auth.project.id),
        or(eq(sessions.state, 'idle'), eq(sessions.state, 'running')),
      ),
    )
    .returning({ id: sessions.id })
    .get()
  if (!started) {
    throw new Error('Session runtime is no longer active')
  }

  if (cloudTurnsRunInline(env)) {
    await executeCloudSessionTurn(env, db, auth, session, { prompt: initialPrompt }, 'session.initial_prompt')
    return
  }
  await enqueueCloudTurn(env, {
    type: 'session.turn',
    sessionId: session.id,
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    prompt: initialPrompt,
    auditAction: 'session.initial_prompt',
  })
}

// ── Prompt dispatch ─────────────────────────────────────────────────────────

export type PromptDispatchOutcome =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: ReturnType<typeof safeRuntimeError> }
  | { ok: true; delivery: MessageDelivery; state: MessageState }

export async function dispatchSessionPrompt(
  env: Env,
  db: Db,
  auth: AuthContext,
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
  const started = await db
    .update(sessions)
    .set({ state: 'running', stateReason: null, updatedAt: submittedAt })
    .where(
      and(
        eq(sessions.id, session.id),
        eq(sessions.projectId, auth.project.id),
        or(eq(sessions.state, 'idle'), eq(sessions.state, 'running')),
      ),
    )
    .returning({ id: sessions.id })
    .get()
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
  auth: AuthContext,
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
  const queued = await db
    .update(sessions)
    .set({ state: 'pending', stateReason: 'waiting-for-runner', updatedAt: submittedAt })
    .where(
      and(
        eq(sessions.id, session.id),
        eq(sessions.projectId, auth.project.id),
        or(eq(sessions.state, 'idle'), eq(sessions.state, 'running')),
      ),
    )
    .returning({ id: sessions.id })
    .get()
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

async function assertRuntimeSessionRunning(db: Db, auth: AuthContext, sessionId: string) {
  const active = await db
    .select({ state: sessions.state })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id)))
    .get()
  if (active?.state !== 'running') {
    throw new RuntimeTurnCancelledError()
  }
}

async function loadRuntimeMessages(db: Db, sessionId: string) {
  const rows = await db
    .select({ type: sessionEvents.type, payload: sessionEvents.payload })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.sequence))
    .all()
  return runtimeMessagesFromEvents(rows)
}

async function markInitialPromptFailed(
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  message: string,
  status?: number,
) {
  const failedAt = now()
  await db
    .update(sessions)
    .set({ state: 'error', stateReason: message, updatedAt: failedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'running')))
  await recordAudit(db, {
    auth,
    action: 'session.initial_prompt',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'failure',
    sessionId: session.id,
    metadata: { message, ...(status ? { status } : {}) },
  })
}

export async function appendRuntimeEvent(
  db: Db,
  values: { auth: AuthContext; sessionId: string; event: Record<string, unknown>; metadata?: Record<string, unknown> },
) {
  const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
    values.event,
    values.metadata ?? { source: 'runtime' },
  )
  return await insertCanonicalSessionEvent(
    db,
    { organizationId: values.auth.organization.id, projectId: values.auth.project.id, sessionId: values.sessionId },
    canonicalEvent,
  )
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

// ── Stop / archive ──────────────────────────────────────────────────────────

export type StopSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

export async function stopSession(
  env: Env,
  db: Db,
  auth: AuthContext,
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
  auth: AuthContext,
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

  const stoppingAt = now()
  await db
    .update(sessions)
    .set({ state: 'stopped', updatedAt: stoppingAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))

  try {
    await stopCloudSessionRuntime(env, session.sandboxId)
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    await db
      .update(sessions)
      .set({ state: 'error', stateReason: safeError.message, updatedAt: failedAt })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
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
  await db
    .update(sessions)
    .set({ state: 'stopped', stoppedAt, updatedAt: stoppedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
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
  auth: AuthContext,
  session: SessionRow,
  requestId: string | null,
  reason: string,
): Promise<StopSessionResult> {
  const stoppedAt = now()
  await dispatchRunnerSessionCommand(env, session.id, { type: 'stop', reason })
  const activeWorkItems = await db
    .select({ id: workItems.id, runnerId: workItems.runnerId, leaseId: workItems.leaseId })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, auth.project.id),
        eq(workItems.sessionId, session.id),
        inArray(workItems.state, ['available', 'leased']),
      ),
    )

  if (activeWorkItems.length) {
    const workItemIds = activeWorkItems.map((item) => item.id)
    const leaseIds = activeWorkItems.map((item) => item.leaseId).filter((id): id is string => Boolean(id))
    const runnerIds = [
      ...new Set(activeWorkItems.map((item) => item.runnerId).filter((id): id is string => Boolean(id))),
    ]

    await db
      .update(workItems)
      .set({
        state: 'cancelled',
        leaseExpiresAt: null,
        error: stringify({ message: `Session stopped: ${reason}` }),
        updatedAt: stoppedAt,
      })
      .where(and(eq(workItems.projectId, auth.project.id), inArray(workItems.id, workItemIds)))

    if (leaseIds.length) {
      await db
        .update(leases)
        .set({ state: 'cancelled', updatedAt: stoppedAt })
        .where(and(eq(leases.projectId, auth.project.id), inArray(leases.id, leaseIds)))
    }

    for (const runnerId of runnerIds) {
      await db
        .update(runners)
        .set({
          currentLoad: sql`case when ${runners.currentLoad} > 0 then ${runners.currentLoad} - 1 else 0 end`,
          updatedAt: stoppedAt,
        })
        .where(and(eq(runners.id, runnerId), eq(runners.projectId, auth.project.id)))
    }
  }

  await db
    .update(sessions)
    .set({ state: 'stopped', stateReason: 'runner-cancelled', stoppedAt, updatedAt: stoppedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))

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
  auth: AuthContext,
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
  await db
    .update(sessions)
    .set({ archivedAt, updatedAt: archivedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
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
  auth: AuthContext,
  sessionId: string,
  requestId: string | null,
): Promise<SessionRow> {
  const timestamp = now()
  await db
    .update(sessions)
    .set({ archivedAt: null, updatedAt: timestamp })
    .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id)))
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
export async function markExpiredPendingSessions(db: Db, auth: AuthContext) {
  const expiredBefore = new Date(Date.now() - RUNTIME_START_TIMEOUT_MS).toISOString()
  const timestamp = now()
  await db
    .update(sessions)
    .set({ state: 'error', stateReason: 'Session runtime startup timed out', updatedAt: timestamp })
    .where(
      and(
        eq(sessions.projectId, auth.project.id),
        eq(sessions.state, 'pending'),
        or(
          isNull(sessions.stateReason),
          and(ne(sessions.stateReason, 'requires-runner'), ne(sessions.stateReason, 'waiting-for-runner')),
        ),
        sql`${sessions.createdAt} < ${expiredBefore}`,
      ),
    )
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
  auth: AuthContext,
  sessionId: string,
  approvalId: string,
  body: { decision: 'approve' | 'deny'; reason?: string; result?: Record<string, unknown> },
): Promise<ApprovalDecisionResult> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  const { pending } = sessionApprovalState(parseJson<Record<string, unknown>>(session.metadata) ?? {})
  if (!pending) {
    const alreadyDecided = await db
      .select()
      .from(sessionApprovals)
      .where(
        and(
          eq(sessionApprovals.id, approvalId),
          eq(sessionApprovals.sessionId, session.id),
          eq(sessionApprovals.projectId, auth.project.id),
        ),
      )
      .get()
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
  await db
    .insert(sessionApprovals)
    .values(approvalRow)
    .onConflictDoUpdate({
      target: [sessionApprovals.sessionId, sessionApprovals.toolCallId],
      set: {
        state: approvalRow.state,
        reason: approvalRow.reason,
        result: approvalRow.result,
        decidedByUserId: approvalRow.decidedByUserId,
        decidedAt,
        updatedAt: decidedAt,
      },
    })
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
  await db
    .update(sessions)
    .set({ state: 'running', stateReason: null, updatedAt: now() })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
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
