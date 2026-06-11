import { createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, lte, max, ne, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import {
  AMA_SESSION_EVENT_TYPES,
  type AmaSessionEventType,
  canonicalAmaSessionEventFromRuntimeEvent,
  isAmaSessionEventType,
} from '../../shared/session-events'
import { recordAudit, requestId } from '../audit'
import { type AuthContext, requireAuth } from '../auth/session'
import {
  agentDefinitions,
  agentDefinitionVersions,
  agentMemories,
  environments,
  environmentVersions,
  mcpConnections,
  mcpConnectionTools,
  runners,
  runnerWorkItems,
  runnerWorkLeases,
  sessionEvents,
  sessions,
  vaultCredentials,
  vaultCredentialVersions,
} from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  eventListQuerySchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  paginateSequenceRows,
  parseListCursor,
} from '../openapi'
import { evaluateMcpToolPolicy, evaluateProviderPolicy, evaluateSandboxRuntimePolicy } from '../policy'
import { redactSensitiveValue } from '../redaction'
import {
  runnerSupportsRuntimeProviderModel,
  runtimeCatalogSupportsProviderModel,
  runtimeRequiredRunnerCapability,
  runtimeSupportsLivePrompts,
} from '../runtime/catalog'
import { runtimeDriver, runtimeDriverName, runtimeMetadata } from '../runtime/drivers'
import { safeRuntimeError } from '../runtime/runtime-error'
import { resolveRuntimeSecretEnv } from '../runtime/secret-env'
import {
  isRuntimeTurnCancelled,
  RuntimeTurnCancelledError,
  runSessionTurn,
  runtimeEndpointPath,
  runtimeMessagesFromEvents,
  stopSessionRuntime as stopCloudSessionRuntime,
} from '../runtime/session-runtime'
import { type CloudTurnMessage, cloudTurnsRunInline, enqueueCloudTurn } from '../runtime/turn-queue'
import {
  type EnvironmentHostingMode,
  EnvironmentHostingModeSchema,
  type EnvironmentNetworkPolicy,
  EnvironmentNetworkPolicySchema,
  normalizeEnvironmentNetworkPolicy,
  type RuntimeName,
  RuntimeSchema,
} from './environment-contracts'
import { dispatchRunnerSessionCommand } from './runners'

const app = createApiRouter()

const SESSION_STATUSES = ['pending', 'running', 'idle', 'stopped', 'error', 'archived', 'requires-action'] as const
const EVENT_VISIBILITIES = ['runtime', 'transcript', 'debug', 'audit'] as const
const RUNTIME_START_TIMEOUT_MS = 300_000

const JsonObjectSchema = z.record(z.string(), z.unknown())
const GitHubOwnerSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/, 'Use a GitHub owner slug.')
const GitHubRepoSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use a GitHub repository name.')
  .refine((value) => value !== '.' && value !== '..', 'Use a GitHub repository name.')
const GitRefSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/[\s\p{C}]/u.test(value) &&
      !value.includes('..') &&
      !value.includes('@{') &&
      !value.includes('\\') &&
      !value.startsWith('-') &&
      !value.endsWith('/') &&
      !value.endsWith('.lock'),
    'Use a safe branch, tag, or commit ref.',
  )
const MountPathSchema = z.string().min(1).max(200)
const CredentialRefSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^vault(?:cred|ver)_[A-Za-z0-9]+$/, 'Use a vault credential or credential version id.')
const GitHubRepositoryResourceRefSchema = z
  .object({
    type: z.literal('github_repository'),
    owner: GitHubOwnerSchema,
    repo: GitHubRepoSchema,
    ref: GitRefSchema.optional(),
    mountPath: MountPathSchema.optional(),
    credentialRef: CredentialRefSchema.optional(),
  })
  .strict()
  .openapi('GitHubRepositoryResourceRef')
const LegacyResourceRefSchema = JsonObjectSchema.refine((value) => value.type !== 'github_repository', {
  message: 'GitHub repository resources must use the github_repository schema.',
})
const ResourceRefSchema = z
  .union([GitHubRepositoryResourceRefSchema, LegacyResourceRefSchema])
  .openapi('SessionResourceRef')
export type GitHubRepositoryResourceRef = z.infer<typeof GitHubRepositoryResourceRefSchema>
const RuntimeSecretEnvSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use a valid environment variable name.'),
    ref: z
      .string()
      .min(1)
      .max(120)
      .regex(/^vaultver_[A-Za-z0-9_]+$/, 'Use a vault credential version id.'),
  })
  .strict()
  .openapi('SessionRuntimeSecretEnvRef')
const AgentVersionSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    instructions: z.string().nullable(),
    provider: z.string(),
    model: z.string().nullable(),
    systemPrompt: z.string().nullable(),
    skills: z.array(z.string()),
    subagents: z.array(JsonObjectSchema),
    role: z.string().nullable(),
    capabilityTags: z.array(z.string()),
    handoffPolicy: JsonObjectSchema,
    memoryPolicy: JsonObjectSchema,
    allowedTools: z.array(z.string()),
    mcpConnectors: z.array(z.string()),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionAgentSnapshot')

const EnvironmentVersionSchema = z
  .object({
    id: z.string(),
    environmentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    packages: z.array(JsonObjectSchema),
    variables: JsonObjectSchema,
    secretRefs: z.array(JsonObjectSchema),
    hostingMode: EnvironmentHostingModeSchema,
    networkPolicy: EnvironmentNetworkPolicySchema,
    mcpPolicy: JsonObjectSchema,
    packageManagerPolicy: JsonObjectSchema,
    resourceLimits: JsonObjectSchema,
    runtimeConfig: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionEnvironmentSnapshot')

const SessionRuntimeMetadataSchema = z
  .object({
    hostingMode: EnvironmentHostingModeSchema,
    runtime: RuntimeSchema,
    runtimeConfig: JsonObjectSchema,
    provider: z.string().openapi({ example: 'workers-ai' }),
    model: z.string().nullable().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    driver: z.string().nullable().openapi({ example: 'ama-cloud' }),
    backend: z.string().nullable().openapi({ example: 'ama-cloud' }),
    protocol: z.string().nullable().openapi({ example: 'ama-runtime-rpc' }),
  })
  .openapi('SessionRuntimeMetadata')

export const SessionSchema = z
  .object({
    id: z.string().openapi({ example: 'session_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    agentVersionId: z.string().openapi({ example: 'agentver_abc123' }),
    agentSnapshot: AgentVersionSchema,
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    environmentVersionId: z.string().nullable().openapi({ example: 'envver_abc123' }),
    environmentSnapshot: EnvironmentVersionSchema.nullable(),
    title: z.string().nullable().openapi({ example: 'Implement billing export' }),
    resourceRefs: z
      .array(ResourceRefSchema)
      .openapi({ example: [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', ref: 'main' }] }),
    vaultRefs: z.array(JsonObjectSchema).openapi({ example: [{ type: 'credential', id: 'cred_abc123' }] }),
    runtimeEnv: JsonObjectSchema.openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    runtimeSecretEnv: z.array(RuntimeSecretEnvSchema).openapi({
      example: [{ name: 'AK_AGENT_KEY', ref: 'vaultver_abc123' }],
    }),
    durableObjectName: z.string().openapi({ example: 'org_org123:project_project123:session_session123' }),
    sandboxId: z.string().nullable().openapi({ example: 'session_abc123' }),
    runtimeEndpointPath: z.string().nullable().openapi({ example: '/runtime/sessions/session_abc123/rpc' }),
    runtimeMetadata: SessionRuntimeMetadataSchema,
    status: z.enum(SESSION_STATUSES).openapi({ example: 'idle' }),
    statusReason: z.string().nullable(),
    metadata: JsonObjectSchema,
    startedAt: z.string().datetime().nullable(),
    stoppedAt: z.string().datetime().nullable(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Session')

const SessionEventSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    sessionId: z.string(),
    sequence: z.number().int(),
    type: z.enum(AMA_SESSION_EVENT_TYPES),
    visibility: z.enum(EVENT_VISIBILITIES),
    role: z.string().nullable(),
    parentEventId: z.string().nullable(),
    correlationId: z.string().nullable(),
    payload: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionEvent')

const CreateSessionSchema = z
  .object({
    agentId: z.string().min(1).openapi({ example: 'agent_abc123' }),
    environmentId: z.string().min(1).openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    runtimeConfig: JsonObjectSchema.optional().openapi({ example: { sandboxMode: 'workspace-write' } }),
    title: z.string().min(1).max(160).optional().openapi({ example: 'Implement billing export' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { ticket: 'AMA-123' } }),
    resourceRefs: z
      .array(ResourceRefSchema)
      .max(50)
      .optional()
      .openapi({
        example: [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', ref: 'main' }],
      }),
    vaultRefs: z
      .array(JsonObjectSchema)
      .max(50)
      .optional()
      .openapi({ example: [{ type: 'credential', id: 'cred_abc123' }] }),
    runtimeEnv: z
      .record(z.string(), z.string())
      .optional()
      .openapi({ example: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_abc123' } }),
    runtimeSecretEnv: z
      .array(RuntimeSecretEnvSchema)
      .max(50)
      .optional()
      .openapi({ example: [{ name: 'AK_AGENT_KEY', ref: 'vaultver_abc123' }] }),
    initialPrompt: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .optional()
      .openapi({ example: 'Research Canadian banking bonus offers and summarize current opportunities.' }),
  })
  .strict()
  .openapi('CreateSessionRequest')

const UpdateSessionSchema = z
  .object({
    status: z.enum(['stopped', 'archived']).openapi({ example: 'stopped' }),
  })
  .openapi('UpdateSessionRequest')

const CreateSessionCommandSchema = z
  .object({
    type: z.literal('prompt').openapi({ example: 'prompt' }),
    message: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .openapi({ example: 'Please continue the task and summarize the current blocker.' }),
  })
  .strict()
  .openapi('CreateSessionCommandRequest')

const SessionCommandResponseSchema = z
  .object({
    runtime: z.enum(['ama-cloud', 'self-hosted-runner']).openapi({ example: 'ama-cloud' }),
    accepted: z.boolean().openapi({ example: true }),
    sessionId: z.string().openapi({ example: 'session_abc123' }),
    path: z.string().openapi({ example: '/rpc' }),
    delivery: z.enum(['live', 'queued']).optional().openapi({ example: 'queued' }),
  })
  .openapi('SessionCommandResponse')

const ParamsSchema = z.object({
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' }, example: 'session_abc123' }),
})
const StopSessionQuerySchema = z.object({
  reason: z
    .enum(['user_requested', 'timeout', 'policy', 'runtime_error'])
    .optional()
    .openapi({ param: { name: 'reason', in: 'query' }, example: 'user_requested' }),
})

const ListQuerySchema = listQuerySchema(SESSION_STATUSES)
const EventsQuerySchema = eventListQuerySchema().extend({
  type: z
    .enum(AMA_SESSION_EVENT_TYPES)
    .optional()
    .openapi({ param: { name: 'type', in: 'query' }, example: 'message_end' }),
  visibility: z
    .enum(EVENT_VISIBILITIES)
    .optional()
    .openapi({ param: { name: 'visibility', in: 'query' }, example: 'runtime' }),
  createdFrom: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdFrom', in: 'query' }, example: '2026-05-01T00:00:00.000Z' }),
  createdTo: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdTo', in: 'query' }, example: '2026-05-31T23:59:59.999Z' }),
})
const SessionListResponseSchema = listResponseSchema('SessionListResponse', SessionSchema)
const SessionEventListResponseSchema = listResponseSchema('SessionEventListResponse', SessionEventSchema)

type Db = ReturnType<typeof drizzle>
type AgentRow = typeof agentDefinitions.$inferSelect
type AgentVersionRow = typeof agentDefinitionVersions.$inferSelect
type EnvironmentVersionRow = typeof environmentVersions.$inferSelect
type SessionRow = typeof sessions.$inferSelect
type SessionEventRow = typeof sessionEvents.$inferSelect
type EventOrder = 'asc' | 'desc'

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

function secretKey(key: string) {
  return /secret|token|password|api[_-]?key/i.test(key)
}

function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

function hasEmbeddedCredentialUrl(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      const url = new URL(value)
      return Boolean(url.username || url.password)
    } catch {
      return false
    }
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasEmbeddedCredentialUrl)
  }
  return Object.values(value).some(hasEmbeddedCredentialUrl)
}

function normalizeMountPath(resource: Pick<GitHubRepositoryResourceRef, 'owner' | 'repo' | 'mountPath'>) {
  const requested = resource.mountPath?.trim() || `repos/${resource.owner}/${resource.repo}`
  if (/[\p{C}\\]/u.test(requested)) {
    throw new Error('Mount path contains invalid characters.')
  }
  if (requested.startsWith('/') && !requested.startsWith('/workspace/')) {
    throw new Error('Mount path must stay under /workspace.')
  }
  const relativePath = requested.startsWith('/workspace/') ? requested.slice('/workspace/'.length) : requested
  const segments = relativePath.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    segments[0] === '.ama'
  ) {
    throw new Error('Mount path must use clean relative segments outside /workspace/.ama.')
  }
  if (!segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Mount path segments may contain only letters, numbers, dots, underscores, and hyphens.')
  }
  return `/workspace/${segments.join('/')}`
}

function normalizeResourceRefs(resourceRefs: Array<z.infer<typeof ResourceRefSchema>>) {
  const normalized: Array<z.infer<typeof ResourceRefSchema>> = []
  const mountPaths = new Set<string>()
  for (const [index, resourceRef] of resourceRefs.entries()) {
    if (hasEmbeddedCredentialUrl(resourceRef)) {
      return {
        fields: { [`resourceRefs.${index}`]: 'URLs with embedded credentials are not allowed.' },
      }
    }
    if (resourceRef.type !== 'github_repository') {
      normalized.push(resourceRef)
      continue
    }
    const parsed = GitHubRepositoryResourceRefSchema.safeParse(resourceRef)
    if (!parsed.success) {
      return {
        fields: { [`resourceRefs.${index}`]: parsed.error.issues[0]?.message ?? 'Invalid GitHub repository resource.' },
      }
    }
    let mountPath: string
    try {
      mountPath = normalizeMountPath(parsed.data)
    } catch (error) {
      return {
        fields: { [`resourceRefs.${index}.mountPath`]: error instanceof Error ? error.message : String(error) },
      }
    }
    if (mountPaths.has(mountPath)) {
      return {
        fields: { [`resourceRefs.${index}.mountPath`]: 'Mount path must be unique within a session.' },
      }
    }
    mountPaths.add(mountPath)
    normalized.push({
      type: 'github_repository',
      owner: parsed.data.owner,
      repo: parsed.data.repo,
      mountPath,
      ...(parsed.data.ref ? { ref: parsed.data.ref } : {}),
      ...(parsed.data.credentialRef ? { credentialRef: parsed.data.credentialRef } : {}),
    })
  }
  return { resourceRefs: normalized }
}

async function validateResourceCredentialRefs(
  db: Db,
  auth: AuthContext,
  resourceRefs: Array<z.infer<typeof ResourceRefSchema>>,
) {
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
            eq(vaultCredentialVersions.status, 'active'),
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
          eq(vaultCredentials.status, 'active'),
        ),
      )
      .get()
    if (!credential) {
      return { credentialRef: 'Credential must exist, be active, and belong to this project or organization.' }
    }
  }
  return null
}

async function validateRuntimeSecretEnvRefs(
  db: Db,
  auth: AuthContext,
  runtimeSecretEnv: Array<z.infer<typeof RuntimeSecretEnvSchema>>,
) {
  const names = new Set<string>()
  for (const [index, ref] of runtimeSecretEnv.entries()) {
    const field = `runtimeSecretEnv.${index}`
    if (names.has(ref.name)) {
      return { [`${field}.name`]: 'Runtime secret environment variable names must be unique.' }
    }
    names.add(ref.name)
    const version = await db
      .select({ id: vaultCredentialVersions.id })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, ref.ref),
          eq(vaultCredentialVersions.organizationId, auth.organization.id),
          or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
          eq(vaultCredentialVersions.status, 'active'),
        ),
      )
      .get()
    if (!version) {
      return {
        [`${field}.ref`]: 'Secret reference must be an active credential version in this project or organization.',
      }
    }
  }
  return null
}

function serializeAgentVersion(row: AgentVersionRow) {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    instructions: row.instructions,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt,
    skills: JSON.parse(row.skills) as string[],
    subagents: JSON.parse(row.subagents) as Record<string, unknown>[],
    role: row.role,
    capabilityTags: JSON.parse(row.capabilityTags) as string[],
    handoffPolicy: JSON.parse(row.handoffPolicy) as Record<string, unknown>,
    memoryPolicy: JSON.parse(row.memoryPolicy) as Record<string, unknown>,
    allowedTools: JSON.parse(row.allowedTools) as string[],
    mcpConnectors: JSON.parse(row.mcpConnectors) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

type SerializedAgentVersion = ReturnType<typeof serializeAgentVersion>

function parseAgentSnapshot(value: string | null) {
  const parsed = parseJson<SerializedAgentVersion & { sandboxPolicy?: unknown }>(value)
  if (!parsed) {
    return null
  }
  const { sandboxPolicy: _sandboxPolicy, ...snapshot } = parsed
  return {
    ...snapshot,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    subagents: Array.isArray(parsed.subagents)
      ? parsed.subagents.filter(
          (value): value is Record<string, unknown> =>
            value !== null && typeof value === 'object' && !Array.isArray(value),
        )
      : [],
    role: typeof parsed.role === 'string' ? parsed.role : null,
    capabilityTags: Array.isArray(parsed.capabilityTags) ? parsed.capabilityTags : [],
    handoffPolicy: objectValue(parsed.handoffPolicy),
    memoryPolicy: objectValue(parsed.memoryPolicy),
  } satisfies SerializedAgentVersion
}

function serializeEnvironmentVersion(row: EnvironmentVersionRow) {
  return {
    ...row,
    packages: JSON.parse(row.packages) as Record<string, unknown>[],
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    secretRefs: JSON.parse(row.secretRefs) as Record<string, unknown>[],
    hostingMode: row.hostingMode as EnvironmentHostingMode,
    networkPolicy: JSON.parse(row.networkPolicy) as Record<string, unknown>,
    mcpPolicy: JSON.parse(row.mcpPolicy) as Record<string, unknown>,
    packageManagerPolicy: JSON.parse(row.packageManagerPolicy) as Record<string, unknown>,
    resourceLimits: JSON.parse(row.resourceLimits) as Record<string, unknown>,
    runtimeConfig: JSON.parse(row.runtimeConfig) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  }
}

type NormalizedEnvironmentSnapshot = Omit<
  ReturnType<typeof serializeEnvironmentVersion>,
  'hostingMode' | 'networkPolicy' | 'runtimeConfig'
> & {
  hostingMode: EnvironmentHostingMode
  networkPolicy: EnvironmentNetworkPolicy
  runtimeConfig: Record<string, unknown>
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function snapshotHostingMode(snapshot: Record<string, unknown>): EnvironmentHostingMode {
  const parsed = EnvironmentHostingModeSchema.safeParse(snapshot.hostingMode)
  return parsed.success ? parsed.data : 'cloud'
}

function normalizeEnvironmentSnapshot(
  snapshot: ReturnType<typeof serializeEnvironmentVersion> | Record<string, unknown> | null,
): NormalizedEnvironmentSnapshot | null {
  if (!snapshot) {
    return null
  }
  const snapshotRecord = snapshot as Record<string, unknown>
  return {
    ...snapshotRecord,
    hostingMode: snapshotHostingMode(snapshotRecord),
    networkPolicy: normalizeEnvironmentNetworkPolicy(snapshotRecord.networkPolicy),
    runtimeConfig: objectValue(snapshotRecord.runtimeConfig),
  } as NormalizedEnvironmentSnapshot
}

function environmentHostingMode(snapshot: NormalizedEnvironmentSnapshot | null) {
  return snapshot?.hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud'
}

function sessionRuntimeFromMetadata(metadata: Record<string, unknown>): RuntimeName {
  const parsed = RuntimeSchema.safeParse(metadata.runtime)
  if (!parsed.success) {
    throw new Error('Session runtime metadata is required')
  }
  return parsed.data
}

function sessionRuntimeConfig(metadata: Record<string, unknown>) {
  return objectValue(metadata.runtimeConfig)
}

function sessionModel(modelConfig: Record<string, unknown>, agentSnapshot: ReturnType<typeof serializeAgentVersion>) {
  return typeof modelConfig.model === 'string'
    ? modelConfig.model
    : typeof agentSnapshot.model === 'string'
      ? agentSnapshot.model
      : null
}

function serializeSession(row: SessionRow) {
  const agentSnapshot = parseAgentSnapshot(row.agentSnapshot)
  if (!agentSnapshot) {
    throw new Error('Session agent snapshot is required')
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof serializeEnvironmentVersion>>(row.environmentSnapshot),
  )
  const metadata = parseJson<Record<string, unknown>>(row.metadata) ?? {}
  const modelConfig = parseJson<Record<string, unknown>>(row.modelConfig) ?? {}
  const hostingMode = environmentHostingMode(environmentSnapshot)
  const runtime = sessionRuntimeFromMetadata(metadata)
  const provider = row.modelProvider ?? agentSnapshot.provider
  const model = sessionModel(modelConfig, agentSnapshot)

  return {
    id: row.id,
    organizationId: row.organizationId ?? '',
    projectId: row.projectId ?? '',
    agentId: row.agentId,
    agentVersionId: row.agentVersionId ?? '',
    agentSnapshot,
    environmentId: row.environmentId,
    environmentVersionId: row.environmentVersionId,
    environmentSnapshot,
    title: row.title,
    resourceRefs: parseJson<z.infer<typeof ResourceRefSchema>[]>(row.resourceRefs) ?? [],
    vaultRefs: parseJson<Record<string, unknown>[]>(row.vaultRefs) ?? [],
    runtimeEnv: parseJson<Record<string, string>>(row.runtimeEnv) ?? {},
    runtimeSecretEnv: parseJson<Array<z.infer<typeof RuntimeSecretEnvSchema>>>(row.runtimeSecretEnv) ?? [],
    durableObjectName: row.durableObjectName,
    sandboxId: row.sandboxId,
    runtimeEndpointPath:
      row.runtimeEndpointPath ??
      (environmentHostingMode(environmentSnapshot) === 'cloud' ? runtimeEndpointPath(row.id) : null),
    runtimeMetadata: runtimeMetadata({
      hostingMode,
      runtime,
      runtimeConfig: sessionRuntimeConfig(metadata),
      provider,
      model,
      metadata,
    }),
    status: row.status as (typeof SESSION_STATUSES)[number],
    statusReason: row.statusReason,
    metadata,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeEvent(row: SessionEventRow) {
  const rawPayload = JSON.parse(row.payload) as Record<string, unknown>
  const rawMetadata = JSON.parse(row.metadata) as Record<string, unknown>
  const event = isAmaSessionEventType(row.type)
    ? {
        type: row.type,
        visibility: row.visibility as (typeof EVENT_VISIBILITIES)[number],
        role: row.role,
        payload: rawPayload,
        metadata: rawMetadata,
      }
    : canonicalAmaSessionEventFromRuntimeEvent(
        { ...rawPayload, type: row.type },
        { source: 'stored-session-event', ...rawMetadata },
      )
  if (!isAmaSessionEventType(row.type)) {
    event.metadata = {
      ...event.metadata,
      rawSessionEventType: row.type,
    }
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    sequence: row.sequence,
    type: event.type,
    visibility: event.visibility,
    role: event.role,
    parentEventId: row.parentEventId,
    correlationId: row.correlationId,
    payload: redactSensitiveValue(event.payload) as Record<string, unknown>,
    metadata: redactSensitiveValue(event.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

function eventSequenceFilter(cursor: number, order: EventOrder) {
  return order === 'asc' ? gt(sessionEvents.sequence, cursor) : lt(sessionEvents.sequence, cursor)
}

function eventCursor(query: { cursor?: number | undefined }) {
  return query.cursor
}

function eventTypeFilter(type: AmaSessionEventType | undefined) {
  if (!type) {
    return undefined
  }
  return eq(sessionEvents.type, type)
}

function eventOrder(order?: EventOrder) {
  return order ?? 'asc'
}

function eventOrderBy(order: EventOrder) {
  return order === 'asc' ? asc(sessionEvents.sequence) : desc(sessionEvents.sequence)
}

function eventCursorFilter(query: { cursor?: number | undefined }, order: EventOrder) {
  const cursor = eventCursor(query)
  if (cursor === undefined) {
    return order === 'asc' ? eventSequenceFilter(0, order) : undefined
  }
  return eventSequenceFilter(cursor, order)
}

async function markExpiredPendingSessions(db: Db, auth: AuthContext) {
  const expiredBefore = new Date(Date.now() - RUNTIME_START_TIMEOUT_MS).toISOString()
  const timestamp = now()
  await db
    .update(sessions)
    .set({
      status: 'error',
      statusReason: 'Session runtime startup timed out',
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(sessions.projectId, auth.project.id),
        eq(sessions.status, 'pending'),
        or(
          isNull(sessions.statusReason),
          and(ne(sessions.statusReason, 'requires-runner'), ne(sessions.statusReason, 'waiting-for-runner')),
        ),
        lt(sessions.createdAt, expiredBefore),
      ),
    )
}

async function enqueueSelfHostedSessionWork(
  _env: Env,
  db: Db,
  auth: AuthContext,
  values: {
    session: SessionRow
    agentSnapshot: ReturnType<typeof serializeAgentVersion>
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs?: Array<z.infer<typeof ResourceRefSchema>>
    runtimeEnv?: Record<string, string>
    runtimeSecretEnv?: Array<z.infer<typeof RuntimeSecretEnvSchema>>
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
    provider: values.agentSnapshot.provider,
    ...(values.agentSnapshot.model ? { model: values.agentSnapshot.model } : {}),
    runtimeDriver: runtimeDriverName(values.runtime, 'self_hosted'),
    agentSnapshot: values.agentSnapshot,
    environmentSnapshot: values.environmentSnapshot,
    runtimeEnv: values.runtimeEnv ?? {},
    runtimeSecretEnv: values.runtimeSecretEnv ?? [],
    initialPrompt: values.initialPrompt ?? null,
    resume: values.resume ?? false,
    resumeToken: values.resumeToken ?? null,
    requiredRunnerCapability:
      values.environmentSnapshot?.hostingMode === 'self_hosted'
        ? runtimeRequiredRunnerCapability(values.runtime, values.agentSnapshot.provider, values.agentSnapshot.model)
        : null,
  }
  await db.insert(runnerWorkItems).values({
    id: newId('work'),
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    sessionId: values.session.id,
    environmentId: values.session.environmentId,
    runnerId: null,
    leaseId: null,
    type: 'session.start',
    status: 'available',
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

// Resolves the freshest runtime resume token for a session. Lease renewals
// persist the live token onto the leased work item payload, so the most
// recently updated work item wins over the result token of an older succeeded
// item; within a row a completion result token is newer than its payload.
async function latestRunnerResumeToken(db: Db, auth: AuthContext, sessionId: string) {
  const rows = await db
    .select({ status: runnerWorkItems.status, payload: runnerWorkItems.payload, result: runnerWorkItems.result })
    .from(runnerWorkItems)
    .where(and(eq(runnerWorkItems.projectId, auth.project.id), eq(runnerWorkItems.sessionId, sessionId)))
    .orderBy(desc(runnerWorkItems.updatedAt))
    .limit(5)
  for (const row of rows) {
    if (row.status === 'succeeded') {
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
  agentSnapshot: ReturnType<typeof serializeAgentVersion>,
  environmentSnapshot: ReturnType<typeof serializeEnvironmentVersion> | NormalizedEnvironmentSnapshot | null,
) {
  const connections = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.projectId, auth.project.id), eq(mcpConnections.status, 'connected')))
  const agentConnectors = agentSnapshot.mcpConnectors
  const scopedConnections =
    agentConnectors.length === 0
      ? connections
      : connections.filter((connection) => agentConnectors.includes(connection.connectorId))

  const snapshotConnections = []
  const sessionContext = {
    id: sessionId,
    agentSnapshot: stringify(agentSnapshot),
    environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
  }
  for (const connection of scopedConnections) {
    const tools = await db
      .select()
      .from(mcpConnectionTools)
      .where(and(eq(mcpConnectionTools.connectionId, connection.id), eq(mcpConnectionTools.status, 'available')))
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
        credentialRef: connection.credentialSecretRef,
        tools: allowedTools,
      })
    }
  }
  return { connectors: snapshotConnections }
}

async function currentAgentVersion(db: Db, agent: AgentRow) {
  if (!agent.currentVersionId) {
    return null
  }
  return (
    (await db
      .select()
      .from(agentDefinitionVersions)
      .where(and(eq(agentDefinitionVersions.id, agent.currentVersionId), eq(agentDefinitionVersions.agentId, agent.id)))
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
  const content = memory?.content.trim()
  if (!content) {
    return initialPrompt
  }
  const memoryBlock = [`Agent memory for this agent:`, content].join('\n')
  return initialPrompt ? `${memoryBlock}\n\nCurrent task:\n${initialPrompt}` : memoryBlock
}

async function validateRuntimeProviderModel(
  db: Db,
  auth: AuthContext,
  environmentId: string,
  hostingMode: EnvironmentHostingMode,
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
          eq(runners.status, 'active'),
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

async function findSession(db: Db, auth: AuthContext, sessionId: string) {
  return (
    (await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id)))
      .get()) ?? null
  )
}

export async function createSessionForAgent(
  c: Context<{ Bindings: Env }>,
  db: Db,
  auth: AuthContext,
  agentId: string,
  environmentId: string,
  options: {
    title?: string
    metadata?: Record<string, unknown>
    resourceRefs?: Array<z.infer<typeof ResourceRefSchema>>
    vaultRefs?: Record<string, unknown>[]
    runtime: RuntimeName
    runtimeConfig?: Record<string, unknown>
    runtimeEnv?: Record<string, string>
    runtimeSecretEnv?: Array<z.infer<typeof RuntimeSecretEnvSchema>>
    initialPrompt?: string
  },
) {
  if (
    hasSecretMaterial(options.metadata) ||
    hasSecretMaterial(options.resourceRefs) ||
    hasSecretMaterial(options.vaultRefs) ||
    hasSecretMaterial(options.runtimeConfig) ||
    hasSecretMaterial(options.runtimeEnv)
  ) {
    return errorResponse(c, 400, 'validation_error', 'Invalid session configuration', {
      fields: {
        metadata: 'Secret material must be stored in vault references.',
        resourceRefs: 'Resource references must not contain secret material.',
        vaultRefs: 'Vault references must not contain raw secret material.',
        runtimeConfig: 'Secret material must be stored in vault references.',
        runtimeEnv: 'Runtime environment variables must not contain raw secret material.',
      },
    })
  }
  const normalizedResources = normalizeResourceRefs(options.resourceRefs ?? [])
  if ('fields' in normalizedResources) {
    return errorResponse(c, 400, 'validation_error', 'Invalid session resource references', {
      fields: normalizedResources.fields,
    })
  }

  const agent = await db
    .select()
    .from(agentDefinitions)
    .where(and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.projectId, auth.project.id)))
    .get()
  if (!agent) {
    return errorResponse(c, 404, 'not_found', 'Agent not found')
  }
  if (agent.status !== 'active') {
    return errorResponse(c, 409, 'conflict', 'Archived agents cannot create sessions')
  }

  const agentVersion = await currentAgentVersion(db, agent)
  if (!agentVersion) {
    throw new Error('Agent current version is required')
  }
  const initialPrompt = await sessionInitialPrompt(db, auth.project.id, agent, options.initialPrompt)
  const policyDecision = await evaluateProviderPolicy(db, auth, {
    providerId: agentVersion.provider,
    modelId: agentVersion.model,
  })
  if (!policyDecision.allowed) {
    await recordAudit(db, {
      auth,
      action: 'session.create',
      resourceType: 'session',
      outcome: 'denied',
      requestId: requestId(c),
      policyCategory: policyDecision.category,
      metadata: { agentId, providerId: agentVersion.provider, modelId: agentVersion.model, decision: policyDecision },
    })
    return errorResponse(c, 403, 'policy_denied', policyDecision.message, {
      category: policyDecision.category,
      resourceType:
        policyDecision.category === 'budget' ? 'budget' : policyDecision.category === 'model' ? 'model' : 'provider',
      resourceId:
        policyDecision.category === 'budget'
          ? policyDecision.rule
          : policyDecision.category === 'model'
            ? agentVersion.model
            : agentVersion.provider,
      ruleId: policyDecision.rule,
    })
  }

  const environment = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.id, environmentId),
        eq(environments.projectId, auth.project.id),
        eq(environments.status, 'active'),
      ),
    )
    .get()
  if (!environment?.currentVersionId) {
    return errorResponse(c, 409, 'conflict', 'Selected environment is archived or unavailable')
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
    return errorResponse(c, 409, 'conflict', 'Selected environment is archived or unavailable')
  }
  const credentialError = await validateResourceCredentialRefs(db, auth, normalizedResources.resourceRefs)
  if (credentialError) {
    return errorResponse(c, 400, 'validation_error', 'Invalid session resource credential reference', {
      fields: credentialError,
    })
  }
  const runtimeSecretEnvError = await validateRuntimeSecretEnvRefs(db, auth, options.runtimeSecretEnv ?? [])
  if (runtimeSecretEnvError) {
    return errorResponse(c, 400, 'validation_error', 'Invalid runtime secret environment references', {
      fields: runtimeSecretEnvError,
    })
  }

  const timestamp = now()
  // Session ids are bare UUIDs so runtimes (e.g. Claude Code) can use them
  // directly as their own session id, keeping the runtime session 1:1 with AMA.
  const id = crypto.randomUUID()
  const agentSnapshot = serializeAgentVersion(agentVersion)
  const baseEnvironmentSnapshot = environmentVersion
    ? normalizeEnvironmentSnapshot(serializeEnvironmentVersion(environmentVersion))
    : null
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
      agentSnapshot.provider,
      agentSnapshot.model,
    ))
  ) {
    return errorResponse(c, 409, 'conflict', 'Unsupported runtime provider/model combination', {
      resourceType: 'runtime_catalog',
      runtime,
      hostingMode,
      provider: agentSnapshot.provider,
      model: agentSnapshot.model,
    })
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
        requestId: requestId(c),
        policyCategory: sandboxDecision.category,
        metadata: { agentId, environmentId, decision: sandboxDecision },
      })
      return errorResponse(c, 403, 'policy_denied', sandboxDecision.message, {
        category: sandboxDecision.category,
        resourceType: 'sandbox',
        resourceId: sandboxId ?? id,
        ruleId: sandboxDecision.rule,
      })
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
    environmentVersionId: environmentVersion?.id ?? null,
    environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
    title: options.title ?? null,
    resourceRefs: stringify(normalizedResources.resourceRefs),
    vaultRefs: stringify(options.vaultRefs ?? []),
    runtimeEnv: stringify(options.runtimeEnv ?? {}),
    runtimeSecretEnv: stringify(options.runtimeSecretEnv ?? []),
    projectId: auth.project.id,
    durableObjectName: `org_${auth.organization.id}:project_${auth.project.id}:session_${id}`,
    sandboxId,
    piRuntimeId: null,
    piProcessId: null,
    runtimeEndpointPath: hostingMode === 'cloud' ? runtimeEndpointPath(id) : null,
    modelProvider: agentSnapshot.provider,
    modelConfig: stringify({
      provider: agentSnapshot.provider,
      ...(agentSnapshot.model ? { model: agentSnapshot.model } : {}),
    }),
    status: 'pending',
    statusReason: hostingMode === 'self_hosted' ? 'waiting-for-runner' : null,
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
  }
  await db.insert(sessions).values(pending)
  await recordAudit(db, {
    auth,
    action: 'session.create',
    resourceType: 'session',
    resourceId: id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: id,
    metadata: { status: pending.status, hostingMode, runtime },
  })

  if (hostingMode === 'self_hosted') {
    await enqueueSelfHostedSessionWork(c.env, db, auth, {
      session: pending,
      agentSnapshot,
      environmentSnapshot,
      runtime,
      runtimeConfig,
      resourceRefs: normalizedResources.resourceRefs,
      runtimeEnv: options.runtimeEnv ?? {},
      runtimeSecretEnv: options.runtimeSecretEnv ?? [],
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    })
    return c.json(serializeSession(pending), 201)
  }

  // Cloud startup (sandbox cold boot, repo clone) outlives the request
  // lifetime cap, so production hands it to the queue consumer; inline mode
  // (tests, bindings-less setups) keeps synchronous semantics.
  if (!cloudTurnsRunInline(c.env)) {
    await enqueueCloudTurn(c.env, {
      type: 'session.start',
      sessionId: pending.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      runtime,
      runtimeConfig,
      resourceRefs: normalizedResources.resourceRefs,
      runtimeEnv: options.runtimeEnv ?? {},
      runtimeSecretEnv: options.runtimeSecretEnv ?? [],
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    })
    return c.json(serializeSession(pending), 201)
  }

  await startSessionRuntimeForRow(c.env, db, auth, {
    pending,
    agentSnapshot,
    environmentSnapshot,
    runtime,
    runtimeConfig,
    resourceRefs: normalizedResources.resourceRefs,
    runtimeEnv: options.runtimeEnv ?? {},
    runtimeSecretEnv: options.runtimeSecretEnv ?? [],
    ...(initialPrompt !== undefined ? { initialPrompt } : {}),
  })
  if (c.env.AMA_RUNTIME_MODE !== 'test') {
    return c.json(serializeSession(pending), 201)
  }
  const started = await findSession(db, auth, id)
  if (!started) {
    throw new Error('Created session was not persisted')
  }
  return c.json(serializeSession(started), 201)
}

async function startSessionRuntimeForRow(
  env: Env,
  db: Db,
  auth: AuthContext,
  input: {
    pending: SessionRow
    agentSnapshot: ReturnType<typeof serializeAgentVersion>
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs: Array<z.infer<typeof ResourceRefSchema>>
    runtimeEnv?: Record<string, string>
    runtimeSecretEnv?: Array<z.infer<typeof RuntimeSecretEnvSchema>>
    initialPrompt?: string
  },
) {
  const {
    pending,
    agentSnapshot,
    environmentSnapshot,
    runtime,
    runtimeConfig,
    resourceRefs,
    runtimeEnv,
    runtimeSecretEnv,
    initialPrompt,
  } = input
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
      runtimeSecretEnv ?? [],
    )
    const runtime = await withTimeout(
      driver.startCloudSession(env, {
        sessionId,
        sandboxId,
        runtime: runtimeName,
        provider: agentSnapshot.provider,
        model: agentSnapshot.model,
        agentSnapshot,
        environmentSnapshot: runtimeEnvironmentSnapshot,
        mcpSnapshot,
        resourceRefs,
        runtimeEnv: runtimeEnv ?? {},
        runtimeSecretEnv: runtimeSecretEnv ?? [],
        resolvedSecretEnv,
      }),
      RUNTIME_START_TIMEOUT_MS,
      'Session runtime startup timed out',
    )
    const current = await findSession(db, auth, sessionId)
    if (current?.status !== 'pending') {
      if (current?.status !== 'idle') {
        await stopCloudSessionRuntime(env, sandboxId).catch(() => undefined)
      }
      return
    }
    const startedAt = now()
    const existingMetadata = parseJson<Record<string, unknown>>(pending.metadata) ?? {}
    const metadata = {
      ...existingMetadata,
      ...runtime.metadata,
      runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
      runtimeBackend: driver.cloudBackend,
      runtimeProtocol: driver.cloudProtocol,
      mcpConnectors: mcpConnectorIds(mcpSnapshot),
    }
    const started = {
      sandboxId,
      piRuntimeId: null,
      piProcessId: null,
      runtimeEndpointPath: runtime.runtimeEndpointPath,
      status: 'idle',
      metadata: stringify(metadata),
      startedAt,
      updatedAt: startedAt,
    }
    await db
      .update(sessions)
      .set(started)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'pending')))
    await recordAudit(db, {
      auth,
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'success',
      sessionId,
      metadata: {
        sandboxId: runtime.sandboxId,
        runtimeEndpointPath: runtime.runtimeEndpointPath,
      },
    })
    if (initialPrompt) {
      await dispatchInitialPrompt(
        env,
        db,
        auth,
        {
          ...pending,
          ...started,
          statusReason: null,
          stoppedAt: null,
          archivedAt: null,
        },
        initialPrompt,
      )
    }
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    const failed = {
      status: 'error',
      statusReason: safeError.message,
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
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'pending')))
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

type CloudTurnOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ReturnType<typeof safeRuntimeError> }

// Runs one cloud session turn end to end: model loop, sandbox tools, event
// persistence, idle transition, and audit. Callers are the queue consumer
// (production) and the inline path (test mode).
async function executeCloudSessionTurn(
  env: Env,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  prompt: string,
  auditAction: 'session.initial_prompt' | 'session.command',
): Promise<CloudTurnOutcome> {
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
    const result = await runSessionTurn(env, {
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      provider: session.modelProvider ?? agentSnapshot.provider,
      model: sessionModel(modelConfig, agentSnapshot),
      agentSnapshot,
      prompt,
      messages,
      ensureActive,
      onEvent: async (event, metadata) => {
        await ensureActive()
        await appendRuntimeEvent(db, {
          auth,
          sessionId: session.id,
          event,
          ...(metadata ? { metadata } : {}),
        })
      },
      approveToolCall: async ({ toolName, input }) => {
        await ensureActive()
        if (toolName === 'sandbox.exec') {
          const command = typeof input.command === 'string' ? input.command : null
          const decision = await evaluateSandboxRuntimePolicy(db, auth, {
            session: {
              id: session.id,
              agentSnapshot: session.agentSnapshot,
              environmentSnapshot: session.environmentSnapshot,
            },
            operation: 'command',
            command,
          })
          if (!decision.allowed) {
            await ensureActive()
            await appendRuntimeEvent(db, {
              auth,
              sessionId: session.id,
              event: {
                type: 'policy_denied',
                category: decision.category,
                ruleId: decision.rule,
                resourceType: 'sandbox_command',
                resourceId: command?.trim().split(/\s+/)[0] ?? 'sandbox.exec',
                decision,
                operation: 'command',
                command,
              },
              metadata: { source: 'policy' },
            })
            await recordAudit(db, {
              auth,
              action: 'runtime_sandbox.operation',
              resourceType: 'sandbox_command',
              resourceId: command?.trim().split(/\s+/)[0] ?? 'sandbox.exec',
              outcome: 'denied',
              sessionId: session.id,
              policyCategory: decision.category,
              metadata: { operation: 'command', command, decision },
            })
          }
          await ensureActive()
          return { allowed: decision.allowed, reason: decision.message }
        }
        return { allowed: true }
      },
    })
    if (result.status === 'idle') {
      await db
        .update(sessions)
        .set({ status: 'idle', updatedAt: now() })
        .where(
          and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'running')),
        )
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
      return { ok: false, cancelled: true }
    }
    const safeError = safeRuntimeError(error)
    await markInitialPromptFailed(db, auth, session, safeError.message)
    return { ok: false, cancelled: false, error: safeError }
  }
}

// Queue consumer entry: re-resolve the session, skip if its status moved on
// while the message was queued, then run the work with the consumer's
// wall-clock budget.
export async function consumeCloudTurnMessage(env: Env, message: CloudTurnMessage): Promise<void> {
  const db = drizzle(env.DB)
  const auth = cloudTurnSystemAuth(message)
  const session = await findSession(db, auth, message.sessionId)
  if (!session) {
    return
  }
  if (message.type === 'session.start') {
    if (session.status !== 'pending') {
      return
    }
    const agentSnapshot = parseJson<ReturnType<typeof serializeAgentVersion>>(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required for cloud startup')
    }
    await startSessionRuntimeForRow(env, db, auth, {
      pending: session,
      agentSnapshot,
      environmentSnapshot: parseJson<NormalizedEnvironmentSnapshot>(session.environmentSnapshot),
      runtime: message.runtime as RuntimeName,
      runtimeConfig: message.runtimeConfig,
      resourceRefs: message.resourceRefs as never,
      runtimeEnv: message.runtimeEnv,
      runtimeSecretEnv: message.runtimeSecretEnv,
      ...(message.initialPrompt !== undefined ? { initialPrompt: message.initialPrompt } : {}),
    })
    return
  }
  // A prompt accepted while another turn was finishing can find the session
  // back in "idle": the finishing turn's idle write races the prompt's
  // running write. The queued prompt is still valid — re-mark and run it.
  if (session.status === 'idle') {
    const reclaimed = await db
      .update(sessions)
      .set({ status: 'running', statusReason: null, updatedAt: now() })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'idle')))
      .returning({ id: sessions.id })
      .get()
    if (!reclaimed) {
      return
    }
  } else if (session.status !== 'running') {
    return
  }
  await executeCloudSessionTurn(env, db, auth, session, message.prompt, message.auditAction)
}

function cloudTurnSystemAuth(message: CloudTurnMessage): AuthContext {
  return {
    user: {
      id: 'system:cloud-turn',
      email: '',
      name: 'AMA cloud turn runner',
      avatarUrl: null,
    },
    organization: {
      id: message.organizationId,
      name: message.organizationId,
    },
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
    .set({ status: 'running', statusReason: null, updatedAt: submittedAt })
    .where(
      and(
        eq(sessions.id, session.id),
        eq(sessions.projectId, auth.project.id),
        or(eq(sessions.status, 'idle'), eq(sessions.status, 'running')),
      ),
    )
    .returning({ id: sessions.id })
    .get()
  if (!started) {
    throw new Error('Session runtime is no longer active')
  }

  if (cloudTurnsRunInline(env)) {
    await executeCloudSessionTurn(env, db, auth, session, initialPrompt, 'session.initial_prompt')
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

async function dispatchSessionPromptCommand(env: Env, db: Db, auth: AuthContext, session: SessionRow, message: string) {
  if (session.status !== 'idle' && session.status !== 'running') {
    return { status: 409 as const, message: 'Session runtime is not active' }
  }
  const path = '/rpc'
  if (!session.sandboxId) {
    const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    if (runtimeSupportsLivePrompts(sessionRuntimeFromMetadata(metadata))) {
      // The lease channel Durable Object only delivers when the connected
      // runner still owns an active lease for this session, so a successful
      // dispatch reaches the live runtime; otherwise queue so the prompt is
      // never lost.
      const delivered = await dispatchRunnerSessionCommand(env, session.id, { type: 'prompt', message })
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
        return {
          status: 202 as const,
          runtime: 'self-hosted-runner' as const,
          accepted: true,
          sessionId: session.id,
          path,
          delivery: 'live' as const,
        }
      }
    }
    return await queueSelfHostedSessionCommand(env, db, auth, session, message, path)
  }

  const submittedAt = now()
  const started = await db
    .update(sessions)
    .set({ status: 'running', statusReason: null, updatedAt: submittedAt })
    .where(
      and(
        eq(sessions.id, session.id),
        eq(sessions.projectId, auth.project.id),
        or(eq(sessions.status, 'idle'), eq(sessions.status, 'running')),
      ),
    )
    .returning({ id: sessions.id })
    .get()
  if (!started) {
    return { status: 409 as const, message: 'Session runtime is no longer active' }
  }

  if (!cloudTurnsRunInline(env)) {
    await enqueueCloudTurn(env, {
      type: 'session.turn',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      prompt: message,
      auditAction: 'session.command',
    })
    return {
      status: 202 as const,
      runtime: 'ama-cloud' as const,
      accepted: true,
      sessionId: session.id,
      path,
      delivery: 'queued' as const,
    }
  }

  const outcome = await executeCloudSessionTurn(env, db, auth, session, message, 'session.command')
  if (!outcome.ok && outcome.cancelled) {
    return { status: 409 as const, message: 'Session runtime is no longer active' }
  }
  if (!outcome.ok) {
    return { status: 500 as const, message: outcome.error.message, runtimeError: outcome.error }
  }
  return { status: 202 as const, runtime: 'ama-cloud' as const, accepted: true, sessionId: session.id, path }
}

async function queueSelfHostedSessionCommand(
  env: Env,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  message: string,
  path: string,
) {
  const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
  if (!agentSnapshot) {
    return { status: 409 as const, message: 'Session agent snapshot is required' }
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof serializeEnvironmentVersion>>(session.environmentSnapshot),
  )
  const submittedAt = now()
  const queued = await db
    .update(sessions)
    .set({ status: 'pending', statusReason: 'waiting-for-runner', updatedAt: submittedAt })
    .where(
      and(
        eq(sessions.id, session.id),
        eq(sessions.projectId, auth.project.id),
        or(eq(sessions.status, 'idle'), eq(sessions.status, 'running')),
      ),
    )
    .returning({ id: sessions.id })
    .get()
  if (!queued) {
    return { status: 409 as const, message: 'Session runtime is no longer active' }
  }
  await enqueueSelfHostedSessionWork(env, db, auth, {
    session,
    agentSnapshot,
    environmentSnapshot,
    runtime: sessionRuntimeFromMetadata(parseJson<Record<string, unknown>>(session.metadata) ?? {}),
    runtimeConfig: sessionRuntimeConfig(parseJson<Record<string, unknown>>(session.metadata) ?? {}),
    resourceRefs: parseJson<Array<z.infer<typeof ResourceRefSchema>>>(session.resourceRefs) ?? [],
    runtimeEnv: parseJson<Record<string, string>>(session.runtimeEnv) ?? {},
    runtimeSecretEnv: parseJson<Array<z.infer<typeof RuntimeSecretEnvSchema>>>(session.runtimeSecretEnv) ?? [],
    initialPrompt: message,
    resume: true,
    resumeToken: await latestRunnerResumeToken(db, auth, session.id),
  })
  return {
    status: 202 as const,
    runtime: 'self-hosted-runner' as const,
    accepted: true,
    sessionId: session.id,
    path,
    delivery: 'queued' as const,
  }
}

async function assertRuntimeSessionRunning(db: Db, auth: AuthContext, sessionId: string) {
  const active = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id)))
    .get()
  if (active?.status !== 'running') {
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
    .set({ status: 'error', statusReason: message, updatedAt: failedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'running')))
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

async function appendRuntimeEvent(
  db: Db,
  values: {
    auth: AuthContext
    sessionId: string
    event: Record<string, unknown>
    metadata?: Record<string, unknown>
  },
) {
  const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
    values.event,
    values.metadata ?? { source: 'runtime' },
  )
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const eventId = newId('event')
    const latest = await db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, values.sessionId))
      .get()
    try {
      await db.insert(sessionEvents).values({
        id: eventId,
        organizationId: values.auth.organization.id,
        projectId: values.auth.project.id,
        sessionId: values.sessionId,
        sequence: (latest?.sequence ?? 0) + 1,
        type: canonicalEvent.type,
        visibility: canonicalEvent.visibility,
        role: canonicalEvent.role,
        parentEventId: null,
        correlationId: null,
        payload: stringify(redactSensitiveValue(canonicalEvent.payload)),
        metadata: stringify(redactSensitiveValue(canonicalEvent.metadata)),
        createdAt: now(),
      })
      return eventId
    } catch (error) {
      if (attempt === 4 || !String(error).includes('UNIQUE')) {
        throw error
      }
    }
  }
  throw new Error('Unable to append runtime event')
}

export function runtimeErrorMessage(payload: Record<string, unknown>) {
  const error = payload.error
  let message: string
  if (typeof error === 'string') {
    message = error
  } else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    message = error.message
  } else if (typeof payload.message === 'string') {
    message = payload.message
  } else {
    message = 'Runtime command failed'
  }
  return redactSensitiveValue(message) as string
}

export async function recoverSessionRuntime(env: Env, db: Db, auth: AuthContext, session: SessionRow) {
  if (!session.sandboxId) {
    throw new Error('Session runtime is unavailable')
  }
  const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
  if (!agentSnapshot) {
    throw new Error('Session agent snapshot is required')
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof serializeEnvironmentVersion>>(session.environmentSnapshot),
  )
  const sessionMetadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
  const runtimeName = sessionRuntimeFromMetadata(sessionMetadata)
  const runtimeConfig = sessionRuntimeConfig(sessionMetadata)
  const driver = runtimeDriver(runtimeName)
  if (!driver.startCloudSession) {
    throw new Error(`Runtime ${runtimeName} does not support cloud session recovery`)
  }
  const normalizedResources = normalizeResourceRefs(
    parseJson<Array<z.infer<typeof ResourceRefSchema>>>(session.resourceRefs) ?? [],
  )
  if ('fields' in normalizedResources) {
    throw new Error('Session resource references are invalid')
  }
  const credentialError = await validateResourceCredentialRefs(db, auth, normalizedResources.resourceRefs)
  if (credentialError) {
    throw new Error('Session resource credential reference is invalid')
  }
  const sandboxDecision = await evaluateSandboxRuntimePolicy(db, auth, {
    session: { id: session.id, agentSnapshot: session.agentSnapshot, environmentSnapshot: session.environmentSnapshot },
    operation: 'startup',
  })
  if (!sandboxDecision.allowed) {
    await recordAudit(db, {
      auth,
      action: 'session.runtime.recover',
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'denied',
      sessionId: session.id,
      policyCategory: sandboxDecision.category,
      metadata: { decision: sandboxDecision },
    })
    throw new Error(sandboxDecision.message)
  }
  const mcpSnapshot = await resolveMcpSnapshot(db, auth, session.id, agentSnapshot, environmentSnapshot)
  await stopCloudSessionRuntime(env, session.sandboxId).catch(() => undefined)
  const runtimeEnvironmentSnapshot = environmentSnapshot ? { ...environmentSnapshot, runtimeConfig } : null
  const runtime = await withTimeout(
    driver.startCloudSession(env, {
      sessionId: session.id,
      sandboxId: session.sandboxId,
      runtime: runtimeName,
      provider: agentSnapshot.provider,
      model: agentSnapshot.model,
      agentSnapshot,
      environmentSnapshot: runtimeEnvironmentSnapshot,
      mcpSnapshot,
      resourceRefs: normalizedResources.resourceRefs,
    }),
    RUNTIME_START_TIMEOUT_MS,
    'Session runtime recovery timed out',
  )
  const recoveredAt = now()
  const metadata = {
    ...(parseJson<Record<string, unknown>>(session.metadata) ?? {}),
    ...runtime.metadata,
    runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
    runtimeBackend: driver.cloudBackend,
    runtimeProtocol: driver.cloudProtocol,
    recoveredAt,
    mcpConnectors: mcpConnectorIds(mcpSnapshot),
  }
  await db
    .update(sessions)
    .set({
      sandboxId: runtime.sandboxId,
      piRuntimeId: null,
      piProcessId: null,
      runtimeEndpointPath: runtime.runtimeEndpointPath,
      status: 'running',
      statusReason: null,
      metadata: stringify(metadata),
      updatedAt: recoveredAt,
    })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.runtime.recover',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    sessionId: session.id,
    metadata: {
      sandboxId: runtime.sandboxId,
      runtimeEndpointPath: runtime.runtimeEndpointPath,
    },
  })
  return runtime
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

async function stopSession(
  c: Context<{ Bindings: Env }>,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  reason = 'user_requested',
) {
  if (session.status === 'stopped') {
    return c.json(serializeSession(session), 200)
  }
  if (session.status === 'archived') {
    return errorResponse(c, 409, 'conflict', 'Archived sessions cannot be stopped')
  }
  if (!session.sandboxId) {
    return await stopSelfHostedSession(c, db, auth, session, reason)
  }

  const stoppingAt = now()
  await db
    .update(sessions)
    .set({ status: 'stopped', updatedAt: stoppingAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))

  try {
    await stopCloudSessionRuntime(c.env, session.sandboxId)
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    await db
      .update(sessions)
      .set({ status: 'error', statusReason: safeError.message, updatedAt: failedAt })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    await recordAudit(db, {
      auth,
      action: 'session.stop',
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'failure',
      requestId: requestId(c),
      sessionId: session.id,
      metadata: { runtime: safeError },
    })
    return errorResponse(c, 409, 'conflict', 'Session runtime could not be stopped', { runtime: safeError })
  }

  const stoppedAt = now()
  await db
    .update(sessions)
    .set({ status: 'stopped', stoppedAt, updatedAt: stoppedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { reason, sandboxId: session.sandboxId, piRuntimeId: session.piRuntimeId },
  })
  const stopped = await findSession(db, auth, session.id)
  if (!stopped) {
    throw new Error('Stopped session row is required')
  }
  return c.json(serializeSession(stopped), 200)
}

async function stopSelfHostedSession(
  c: Context<{ Bindings: Env }>,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  reason: string,
) {
  const stoppedAt = now()
  const activeWorkItems = await db
    .select({ id: runnerWorkItems.id, runnerId: runnerWorkItems.runnerId, leaseId: runnerWorkItems.leaseId })
    .from(runnerWorkItems)
    .where(
      and(
        eq(runnerWorkItems.projectId, auth.project.id),
        eq(runnerWorkItems.sessionId, session.id),
        inArray(runnerWorkItems.status, ['available', 'leased']),
      ),
    )

  if (activeWorkItems.length) {
    const workItemIds = activeWorkItems.map((item) => item.id)
    const leaseIds = activeWorkItems.map((item) => item.leaseId).filter((id): id is string => Boolean(id))
    const runnerIds = [
      ...new Set(activeWorkItems.map((item) => item.runnerId).filter((id): id is string => Boolean(id))),
    ]

    await db
      .update(runnerWorkItems)
      .set({
        status: 'cancelled',
        leaseExpiresAt: null,
        error: stringify({ message: `Session stopped: ${reason}` }),
        updatedAt: stoppedAt,
      })
      .where(and(eq(runnerWorkItems.projectId, auth.project.id), inArray(runnerWorkItems.id, workItemIds)))

    if (leaseIds.length) {
      await db
        .update(runnerWorkLeases)
        .set({
          status: 'cancelled',
          error: stringify({ message: `Session stopped: ${reason}` }),
          updatedAt: stoppedAt,
        })
        .where(and(eq(runnerWorkLeases.projectId, auth.project.id), inArray(runnerWorkLeases.id, leaseIds)))
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
    .set({ status: 'stopped', statusReason: 'runner-cancelled', stoppedAt, updatedAt: stoppedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))

  await recordAudit(db, {
    auth,
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { reason, hostingMode: 'self_hosted', cancelledWorkItems: activeWorkItems.length },
  })

  const stopped = await findSession(db, auth, session.id)
  if (!stopped) {
    throw new Error('Stopped self-hosted session row is required')
  }
  return c.json(serializeSession(stopped), 200)
}

async function archiveSession(c: Context<{ Bindings: Env }>, db: Db, auth: AuthContext, session: SessionRow) {
  if (session.sandboxId && session.status !== 'stopped' && session.status !== 'archived') {
    const stoppedResponse = await stopSession(c, db, auth, session)
    if (!stoppedResponse.ok) {
      return stoppedResponse
    }
  }

  const archivedAt = now()
  await db
    .update(sessions)
    .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.archive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { status: 'archived' },
  })
  return c.body(null, 204)
}

async function archiveSessionAndRead(c: Context<{ Bindings: Env }>, db: Db, auth: AuthContext, session: SessionRow) {
  if (session.sandboxId && session.status !== 'stopped' && session.status !== 'archived') {
    const stoppedResponse = await stopSession(c, db, auth, session)
    if (!stoppedResponse.ok) {
      return stoppedResponse
    }
  }

  const archivedAt = now()
  await db
    .update(sessions)
    .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.archive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { status: 'archived' },
  })
  const archived = await findSession(db, auth, session.id)
  if (!archived) {
    throw new Error('Archived session row is required')
  }
  return c.json(serializeSession(archived), 200)
}

const createSessionRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createSession',
  tags: ['Sessions'],
  summary: 'Create a session',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateSessionSchema } } } },
  responses: {
    201: { description: 'Created session', content: { 'application/json': { schema: SessionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSessions',
  tags: ['Sessions'],
  summary: 'List sessions',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Session list',
      content: { 'application/json': { schema: SessionListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}',
  operationId: 'readSession',
  tags: ['Sessions'],
  summary: 'Read a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateSessionRoute = createRoute({
  method: 'patch',
  path: '/{sessionId}',
  operationId: 'updateSession',
  tags: ['Sessions'],
  summary: 'Update a session lifecycle state',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateSessionSchema } } },
  },
  responses: {
    200: { description: 'Updated session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const stopSessionRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/stop',
  operationId: 'stopSession',
  tags: ['Sessions'],
  summary: 'Stop a session',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    query: StopSessionQuerySchema,
  },
  responses: {
    200: { description: 'Stopped session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionCommandRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/commands',
  operationId: 'createSessionCommand',
  tags: ['Sessions'],
  summary: 'Send a command to an active session',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateSessionCommandSchema } } },
  },
  responses: {
    202: {
      description: 'Session command accepted',
      content: { 'application/json': { schema: SessionCommandResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Runtime error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveSessionRoute = createRoute({
  method: 'delete',
  path: '/{sessionId}',
  operationId: 'archiveSession',
  tags: ['Sessions'],
  summary: 'Archive a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    204: { description: 'Session archived' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const reconnectSessionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/reconnect',
  operationId: 'readSessionReconnect',
  tags: ['Sessions'],
  summary: 'Read reconnect metadata',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Reconnect metadata', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events',
  operationId: 'listSessionEvents',
  tags: ['Sessions'],
  summary: 'List session events',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session events',
      content: { 'application/json': { schema: SessionEventListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const exportEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events/export',
  operationId: 'exportSessionEvents',
  tags: ['Sessions'],
  summary: 'Export session events as NDJSON',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session events export',
      content: { 'application/x-ndjson': { schema: z.string() } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const streamEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events/stream',
  operationId: 'streamSessionEvents',
  tags: ['Sessions'],
  summary: 'Stream session events as NDJSON',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session event stream',
      content: { 'application/x-ndjson': { schema: z.string() } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

type EventsQuery = z.infer<typeof EventsQuerySchema>

async function eventsNdjsonResponse(c: Context<{ Bindings: Env }>, sessionId: string, query: EventsQuery) {
  const { limit = 200, type, visibility, createdFrom, createdTo } = query
  const order = eventOrder(query.order)
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  const filters = [
    eq(sessionEvents.sessionId, sessionId),
    eventCursorFilter(query, order),
    eventTypeFilter(type),
    eq(sessionEvents.visibility, visibility ?? 'runtime'),
    createdFrom ? gte(sessionEvents.createdAt, createdFrom) : undefined,
    createdTo ? lte(sessionEvents.createdAt, createdTo) : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(and(...filters))
    .orderBy(eventOrderBy(order))
    .limit(limit)
  const body = rows.map((row) => JSON.stringify(serializeEvent(row))).join('\n')
  return c.text(body ? `${body}\n` : '', 200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
  })
}

async function streamEventsNdjsonResponse(c: Context<{ Bindings: Env }>, sessionId: string, query: EventsQuery) {
  const { limit = 200, type, visibility, createdFrom, createdTo } = query
  const order = eventOrder(query.order)
  if (order === 'desc') {
    return errorResponse(c, 400, 'validation_error', 'Descending order is not supported for live event streams', {
      fields: { order: 'Use order=asc for event streams or /events for finite historical pages.' },
    })
  }
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }

  const encoder = new TextEncoder()
  let lastSequence = eventCursor(query) ?? 0
  const stream = new ReadableStream({
    async start(controller) {
      const deadline = Date.now() + 1000
      while (Date.now() <= deadline) {
        const filters = [
          eq(sessionEvents.sessionId, sessionId),
          eventSequenceFilter(lastSequence, order),
          eventTypeFilter(type),
          eq(sessionEvents.visibility, visibility ?? 'runtime'),
          createdFrom ? gte(sessionEvents.createdAt, createdFrom) : undefined,
          createdTo ? lte(sessionEvents.createdAt, createdTo) : undefined,
        ].filter((filter) => filter !== undefined)
        const rows = await db
          .select()
          .from(sessionEvents)
          .where(and(...filters))
          .orderBy(eventOrderBy(order))
          .limit(limit)
        for (const row of rows) {
          lastSequence = row.sequence
          controller.enqueue(encoder.encode(`${JSON.stringify(serializeEvent(row))}\n`))
        }
        if (rows.length >= limit) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      controller.close()
    },
  })
  return c.body(stream, 200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
}

const routes = app
  .openapi(createSessionRoute, async (c) => {
    const {
      agentId,
      environmentId,
      title,
      metadata,
      resourceRefs,
      vaultRefs,
      runtime,
      runtimeConfig,
      runtimeEnv,
      runtimeSecretEnv,
      initialPrompt,
    } = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    return await createSessionForAgent(c, db, auth, agentId, environmentId, {
      ...(title !== undefined ? { title } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(resourceRefs !== undefined ? { resourceRefs } : {}),
      ...(vaultRefs !== undefined ? { vaultRefs } : {}),
      runtime,
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
      ...(runtimeEnv !== undefined ? { runtimeEnv } : {}),
      ...(runtimeSecretEnv !== undefined ? { runtimeSecretEnv } : {}),
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    })
  })
  .openapi(listSessionsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await markExpiredPendingSessions(db, auth)

    const { includeArchived, status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(sessions.projectId, auth.project.id),
      status ? eq(sessions.status, status) : includeArchived === 'true' ? undefined : ne(sessions.status, 'archived'),
      search ? like(sessions.agentId, `%${search}%`) : undefined,
      createdFrom ? gte(sessions.createdAt, createdFrom) : undefined,
      createdTo ? lte(sessions.createdAt, createdTo) : undefined,
      parsedCursor
        ? or(
            lt(sessions.createdAt, parsedCursor.createdAt),
            and(eq(sessions.createdAt, parsedCursor.createdAt), lt(sessions.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(sessions)
      .where(and(...filters))
      .orderBy(desc(sessions.createdAt), desc(sessions.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    const data = page.data.map((row) => serializeSession(row))
    return c.json({ data, pagination: page.pagination }, 200)
  })
  .openapi(readSessionRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await markExpiredPendingSessions(db, auth)

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    return c.json(serializeSession(session), 200)
  })
  .openapi(updateSessionRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const { status } = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    if (status === 'stopped') {
      return await stopSession(c, db, auth, session)
    }

    return await archiveSessionAndRead(c, db, auth, session)
  })
  .openapi(stopSessionRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const { reason = 'user_requested' } = c.req.valid('query')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    return await stopSession(c, db, auth, session, reason)
  })
  .openapi(createSessionCommandRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const { message } = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    const result = await dispatchSessionPromptCommand(c.env, db, auth, session, message)
    if (result.status !== 202) {
      return errorResponse(c, result.status, result.status === 500 ? 'internal_error' : 'conflict', result.message, {
        ...('runtimeError' in result ? { runtime: result.runtimeError } : {}),
      })
    }
    return c.json(
      {
        runtime: result.runtime,
        accepted: result.accepted,
        sessionId: result.sessionId,
        path: result.path,
        ...('delivery' in result ? { delivery: result.delivery } : {}),
      },
      202,
    )
  })
  .openapi(archiveSessionRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    return await archiveSession(c, db, auth, session)
  })
  .openapi(reconnectSessionRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    return c.json(serializeSession(session), 200)
  })
  .openapi(listEventsRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const query = c.req.valid('query')
    const { limit = 100, type, visibility, createdFrom, createdTo } = query
    const order = eventOrder(query.order)
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    const filters = [
      eq(sessionEvents.sessionId, sessionId),
      eventCursorFilter(query, order),
      eventTypeFilter(type),
      eq(sessionEvents.visibility, visibility ?? 'runtime'),
      createdFrom ? gte(sessionEvents.createdAt, createdFrom) : undefined,
      createdTo ? lte(sessionEvents.createdAt, createdTo) : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(sessionEvents)
      .where(and(...filters))
      .orderBy(eventOrderBy(order))
      .limit(limit + 1)
    const page = paginateSequenceRows(rows, limit)
    return c.json({ data: page.data.map(serializeEvent), pagination: page.pagination }, 200)
  })
  .openapi(exportEventsRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    return (await eventsNdjsonResponse(c, sessionId, c.req.valid('query'))) as never
  })
  .openapi(streamEventsRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    return (await streamEventsNdjsonResponse(c, sessionId, c.req.valid('query'))) as never
  })

export default routes
