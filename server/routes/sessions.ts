import { createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, ne, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import {
  AMA_SESSION_EVENT_TYPES,
  type AmaSessionEventType,
  canonicalAmaSessionEventFromRuntimeEvent,
  isAmaSessionEventType,
} from '../../shared/session-events'
import { recordAudit, requestId } from '../audit'
import { OidcError } from '../auth/oidc'
import { type AuthContext, isRunnerOidcAuth, requireAuth, resolveAuthContext } from '../auth/session'
import {
  agentMemories,
  agents,
  agentVersions,
  connections,
  connectionTools,
  environments,
  environmentVersions,
  leases,
  // Aliased: `providers` collides with the runtime provider concept used
  // pervasively in this module.
  providers as providersTable,
  runners,
  sessionApprovals,
  sessionEvents,
  sessionMessages,
  sessions,
  vaultCredentials,
  vaultCredentialVersions,
  workItems,
} from '../db/schema'
import { insertCanonicalSessionEvent } from '../db/session-event-store'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  csvResponse,
  ErrorResponseSchema,
  eventListQuerySchema,
  listQuerySchema,
  listResponseSchema,
  negotiateMediaType,
  paginateRows,
  paginateSequenceRows,
  parseListCursor,
  SecretEnvEntrySchema,
} from '../openapi'
import {
  evaluateMcpToolPolicy,
  evaluateProviderPolicyForSession,
  evaluateSandboxRuntimePolicy,
  policyBlocksSandboxOperation,
} from '../policy'
import { redactSensitiveValue } from '../redaction'
import {
  runnerSupportsRuntimeProviderModel,
  runtimeCatalogSupportsProviderModel,
  runtimeRequiredRunnerCapability,
  runtimeSupportsLivePrompts,
} from '../runtime/catalog'
import { runtimeDriver, runtimeDriverName, runtimeMetadata } from '../runtime/drivers'
import { PLATFORM_DEFAULT_PROVIDER, providerRuntimeEnv, resolveSessionProviderConfig } from '../runtime/provider-env'
import { safeRuntimeError } from '../runtime/runtime-error'
import { type RuntimeSecretEnvEntry, resolveRuntimeSecretEnv } from '../runtime/secret-env'
import {
  isRuntimePolicyDenied,
  isRuntimeTurnCancelled,
  RuntimeTurnCancelledError,
  runSessionTurn,
  runtimeEndpointPath,
  runtimeMessagesFromEvents,
  stopSessionRuntime as stopCloudSessionRuntime,
} from '../runtime/session-runtime'
import {
  createToolApprovalGate,
  type PendingSessionApproval,
  type SessionApprovalGrants,
  sessionApprovalState,
  writeSessionApprovalState,
} from '../runtime/tool-approvals'
import { toolExecutor } from '../runtime/tool-executor'
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
import { dispatchRunnerSessionCommand, hasAcceptedRunnerSessionChannel } from './runners'

const app = createApiRouter()

// Operational state machine only. Lifecycle is archivedAt (docs/api-v1-design.md §1.3).
const SESSION_STATES = ['pending', 'running', 'idle', 'stopped', 'error'] as const
const EVENT_VISIBILITIES = ['runtime', 'transcript', 'debug', 'audit'] as const
const MESSAGE_DELIVERIES = ['live', 'queued'] as const
const MESSAGE_STATES = ['accepted', 'delivered', 'failed'] as const
const APPROVAL_STATES = ['pending', 'approved', 'denied'] as const
const RUNTIME_START_TIMEOUT_MS = 300_000
const MAX_EVENT_BATCH = 100

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
const ResourceCredentialRefSchema = z
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
    credentialRef: ResourceCredentialRefSchema.optional(),
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

// Snapshot of the agent version pinned at session start. Isomorphic with the
// Agents domain AgentVersion schema (docs/api-v1-design.md §1.7).
const AgentVersionSnapshotSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    instructions: z.string().nullable(),
    providerId: z.string().openapi({ example: 'workers-ai' }),
    model: z.string().nullable(),
    skills: z.array(z.string()),
    subagents: z.array(JsonObjectSchema),
    role: z.string().nullable(),
    capabilityTags: z.array(z.string()),
    handoffPolicy: JsonObjectSchema,
    memoryPolicy: JsonObjectSchema,
    tools: z.array(JsonObjectSchema),
    mcpConnectors: z.array(z.string()),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionAgentSnapshot')

const EnvironmentVersionSnapshotSchema = z
  .object({
    id: z.string(),
    environmentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    packages: z.array(JsonObjectSchema),
    variables: JsonObjectSchema,
    credentialRefs: z.array(JsonObjectSchema),
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
    projectId: z.string().openapi({ example: 'project_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    agentVersionId: z.string().openapi({ example: 'agentver_abc123' }),
    agentSnapshot: AgentVersionSnapshotSchema,
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    environmentVersionId: z.string().nullable().openapi({ example: 'envver_abc123' }),
    environmentSnapshot: EnvironmentVersionSnapshotSchema.nullable(),
    title: z.string().nullable().openapi({ example: 'Implement billing export' }),
    resourceRefs: z
      .array(ResourceRefSchema)
      .openapi({ example: [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', ref: 'main' }] }),
    env: JsonObjectSchema.openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    secretEnv: z.array(SecretEnvEntrySchema).openapi({
      example: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'cred_abc123', versionId: 'credver_abc123' } }],
    }),
    runtimeMetadata: SessionRuntimeMetadataSchema,
    state: z.enum(SESSION_STATES).openapi({ example: 'idle' }),
    stateReason: z.string().nullable(),
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
    env: z
      .record(z.string(), z.string())
      .optional()
      .openapi({ example: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_abc123' } }),
    secretEnv: z
      .array(SecretEnvEntrySchema)
      .max(50)
      .optional()
      .openapi({ example: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'cred_abc123' } }] }),
    initialPrompt: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .optional()
      .openapi({ example: 'Research Canadian banking bonus offers and summarize current opportunities.' }),
    // Explicit admin override for provider-access denials. Honored only for
    // admin-role callers and always audited with an override marker.
    providerAccessOverride: z.boolean().optional().openapi({ example: false }),
  })
  .strict()
  .openapi('CreateSessionRequest')

const UpdateSessionSchema = z
  .object({
    title: z.string().min(1).max(160).nullable().optional().openapi({ example: 'Implement billing export' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { ticket: 'AMA-123' } }),
    // The only caller-drivable state transition: stop the runtime.
    state: z.literal('stopped').optional().openapi({ example: 'stopped' }),
    archived: z.boolean().optional().openapi({ example: true }),
  })
  .strict()
  .refine(
    (body) =>
      body.title !== undefined ||
      body.metadata !== undefined ||
      body.state !== undefined ||
      body.archived !== undefined,
    { message: 'Provide at least one of title, metadata, state, or archived.' },
  )
  .openapi('UpdateSessionRequest')

const SessionConnectionSchema = z
  .object({
    sessionId: z.string().openapi({ example: 'session_abc123' }),
    transport: z.string().nullable().openapi({
      example: 'ama-runtime-rpc',
      description: 'Runtime protocol the connection path speaks.',
    }),
    path: z.string().nullable().openapi({
      example: '/api/v1/runtime/sessions/session_abc123/rpc',
      description: 'Public runtime proxy path to reconnect to; null while no runtime endpoint is attached.',
    }),
    state: z.enum(SESSION_STATES).openapi({ example: 'idle' }),
    stateReason: z.string().nullable(),
  })
  .openapi('SessionConnection')

const SessionMessageSchema = z
  .object({
    id: z.string().openapi({ example: 'msg_abc123' }),
    sessionId: z.string().openapi({ example: 'session_abc123' }),
    type: z.literal('prompt').openapi({ example: 'prompt' }),
    content: z.string().openapi({ example: 'Please continue the task and summarize the current blocker.' }),
    delivery: z.enum(MESSAGE_DELIVERIES).openapi({ example: 'queued' }),
    state: z.enum(MESSAGE_STATES).openapi({ example: 'accepted' }),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('SessionMessage')

const CreateSessionMessageSchema = z
  .object({
    type: z.literal('prompt').openapi({ example: 'prompt' }),
    content: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .openapi({ example: 'Please continue the task and summarize the current blocker.' }),
  })
  .strict()
  .openapi('CreateSessionMessageRequest')

const SessionEventInputSchema = z
  .object({
    type: z.string().min(1).max(120),
    payload: JsonObjectSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('SessionEventInput')

const CreateSessionEventsSchema = z
  .object({
    events: z.array(SessionEventInputSchema).min(1).max(MAX_EVENT_BATCH),
  })
  .strict()
  .openapi('CreateSessionEventsRequest')

const SessionEventsAcceptedSchema = z
  .object({ accepted: z.number().int().openapi({ example: 3 }) })
  .openapi('SessionEventsAccepted')

const SessionApprovalSchema = z
  .object({
    id: z.string().openapi({ example: 'approval_abc123' }),
    sessionId: z.string().openapi({ example: 'session_abc123' }),
    toolCallId: z.string().openapi({ example: 'call_git_status' }),
    toolName: z.string().openapi({ example: 'sandbox.exec' }),
    input: JsonObjectSchema,
    relatedEventIds: z.array(z.string()).openapi({ example: ['event_abc123'] }),
    state: z.enum(APPROVAL_STATES).openapi({ example: 'pending' }),
    reason: z.string().nullable().openapi({ example: 'Looks safe' }),
    result: JsonObjectSchema.nullable().openapi({
      description: 'Caller-provided custom tool result recorded instead of executing the tool.',
    }),
    requestedAt: z.string().openapi({ example: '2026-06-12T12:00:00.000Z' }),
    decidedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SessionApproval')

const SessionApprovalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'deny']).openapi({ example: 'approve' }),
    reason: z.string().max(500).optional().openapi({ example: 'Looks safe' }),
    result: JsonObjectSchema.optional().openapi({
      description: 'Caller-provided custom tool result recorded instead of executing the tool',
    }),
  })
  .strict()
  .openapi('SessionApprovalDecisionRequest')

const ParamsSchema = z.object({
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' }, example: 'session_abc123' }),
})
const MessageParamsSchema = ParamsSchema.extend({
  messageId: z.string().openapi({ param: { name: 'messageId', in: 'path' }, example: 'msg_abc123' }),
})
const ApprovalParamsSchema = ParamsSchema.extend({
  approvalId: z
    .string()
    .min(1)
    .openapi({ param: { name: 'approvalId', in: 'path' }, example: 'approval_abc123' }),
})

const ListQuerySchema = listQuerySchema().extend({
  state: z
    .enum(SESSION_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'idle' }),
})
const MessageListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 50 }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})
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
const SessionMessageListResponseSchema = listResponseSchema('SessionMessageListResponse', SessionMessageSchema)
const SessionApprovalListResponseSchema = listResponseSchema('SessionApprovalListResponse', SessionApprovalSchema)

type Db = ReturnType<typeof drizzle>
type AgentRow = typeof agents.$inferSelect
type AgentVersionRow = typeof agentVersions.$inferSelect
type EnvironmentVersionRow = typeof environmentVersions.$inferSelect
type SessionRow = typeof sessions.$inferSelect
type SessionEventRow = typeof sessionEvents.$inferSelect
type SessionMessageRow = typeof sessionMessages.$inferSelect
type SessionApprovalRow = typeof sessionApprovals.$inferSelect
type EventOrder = 'asc' | 'desc'
type SecretEnvEntry = z.infer<typeof SecretEnvEntrySchema>
// Internal plumbing always carries a pinned versionId (resolved at creation),
// which keeps it assignable to the runtime dispatch contract.
type ResolvedSecretEnvEntry = { name: string; credentialRef: { credentialId: string; versionId: string } }

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

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

// Validates caller-provided secret env entries and pins each credentialRef to
// a concrete active version so dispatch never re-resolves a moving target.
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
      return {
        fields: { [`${field}.credentialRef.credentialId`]: 'Credential has no active version to resolve.' },
      }
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

type SerializedAgentVersion = ReturnType<typeof serializeAgentVersion>

function parseAgentSnapshot(value: string | null) {
  return parseJson<SerializedAgentVersion>(value)
}

function serializeEnvironmentVersion(row: EnvironmentVersionRow) {
  return {
    ...row,
    packages: JSON.parse(row.packages) as Record<string, unknown>[],
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    credentialRefs: JSON.parse(row.credentialRefs) as Record<string, unknown>[],
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

function sessionModel(modelConfig: Record<string, unknown>, agentSnapshot: SerializedAgentVersion) {
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
  const provider = row.modelProvider ?? agentSnapshot.providerId
  const model = sessionModel(modelConfig, agentSnapshot)

  return {
    id: row.id,
    projectId: row.projectId ?? '',
    agentId: row.agentId,
    agentVersionId: row.agentVersionId ?? '',
    agentSnapshot,
    environmentId: row.environmentId,
    environmentVersionId: row.environmentVersionId,
    environmentSnapshot,
    title: row.title,
    resourceRefs: parseJson<z.infer<typeof ResourceRefSchema>[]>(row.resourceRefs) ?? [],
    env: parseJson<Record<string, string>>(row.env) ?? {},
    secretEnv: parseJson<SecretEnvEntry[]>(row.secretEnv) ?? [],
    runtimeMetadata: runtimeMetadata({
      hostingMode,
      runtime,
      runtimeConfig: sessionRuntimeConfig(metadata),
      provider,
      model,
      metadata,
    }),
    state: row.state as (typeof SESSION_STATES)[number],
    stateReason: row.stateReason,
    metadata,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeSessionConnection(row: SessionRow) {
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof serializeEnvironmentVersion>>(row.environmentSnapshot),
  )
  const metadata = parseJson<Record<string, unknown>>(row.metadata) ?? {}
  const agentSnapshot = parseAgentSnapshot(row.agentSnapshot)
  if (!agentSnapshot) {
    throw new Error('Session agent snapshot is required')
  }
  const hostingMode = environmentHostingMode(environmentSnapshot)
  const runtime = sessionRuntimeFromMetadata(metadata)
  const meta = runtimeMetadata({
    hostingMode,
    runtime,
    runtimeConfig: sessionRuntimeConfig(metadata),
    provider: row.modelProvider ?? agentSnapshot.providerId,
    model: sessionModel(parseJson<Record<string, unknown>>(row.modelConfig) ?? {}, agentSnapshot),
    metadata,
  })
  // The path is the public runtime proxy mount, not the internal endpoint
  // column: cloud sessions always reconnect via the canonical proxy path,
  // self-hosted sessions only once a runner channel attached one.
  const path = row.runtimeEndpointPath ?? (hostingMode === 'cloud' ? runtimeEndpointPath(row.id) : null)
  return {
    sessionId: row.id,
    transport: meta.protocol,
    path,
    state: row.state as (typeof SESSION_STATES)[number],
    stateReason: row.stateReason,
  }
}

function serializeMessage(row: SessionMessageRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    type: row.type as 'prompt',
    content: row.content,
    delivery: row.delivery as (typeof MESSAGE_DELIVERIES)[number],
    state: row.state as (typeof MESSAGE_STATES)[number],
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeApprovalRow(row: SessionApprovalRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    input: parseJson<Record<string, unknown>>(row.input) ?? {},
    relatedEventIds: parseJson<string[]>(row.relatedEventIds) ?? [],
    state: row.state as (typeof APPROVAL_STATES)[number],
    reason: row.reason,
    result: parseJson<Record<string, unknown>>(row.result),
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializePendingApproval(sessionId: string, pending: PendingSessionApproval) {
  return {
    id: pending.id,
    sessionId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    input: pending.input,
    relatedEventIds: pending.relatedEventIds,
    state: 'pending' as const,
    reason: null,
    result: null,
    requestedAt: pending.requestedAt,
    decidedAt: null,
    createdAt: pending.requestedAt,
    updatedAt: pending.requestedAt,
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
  const cursor = query.cursor
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
      state: 'error',
      stateReason: 'Session runtime startup timed out',
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(sessions.projectId, auth.project.id),
        eq(sessions.state, 'pending'),
        or(
          isNull(sessions.stateReason),
          and(ne(sessions.stateReason, 'requires-runner'), ne(sessions.stateReason, 'waiting-for-runner')),
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
    agentSnapshot: SerializedAgentVersion
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs?: Array<z.infer<typeof ResourceRefSchema>>
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

// Resolves the freshest runtime resume token for a session. Lease renewals
// persist the live token onto the leased work item payload, so the most
// recently updated work item wins over the result token of an older succeeded
// item; within a row a completion result token is newer than its payload.
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
  environmentSnapshot: ReturnType<typeof serializeEnvironmentVersion> | NormalizedEnvironmentSnapshot | null,
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
  const content = memory?.content.trim()
  if (!content) {
    return initialPrompt
  }
  const memoryBlock = [`Agent memory for this agent:`, content].join('\n')
  return initialPrompt ? `${memoryBlock}\n\nCurrent task:\n${initialPrompt}` : memoryBlock
}

// Maps an agent version provider reference to the provider key used across
// policy, catalog, and provider-env: the bare platform default normalizes to
// 'workers-ai'; everything else stays the configured provider id. A null
// reference resolves the project default provider at session start.
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
    runtime: RuntimeName
    runtimeConfig?: Record<string, unknown>
    env?: Record<string, string>
    secretEnv?: SecretEnvEntry[]
    initialPrompt?: string
    providerAccessOverride?: boolean
  },
) {
  if (
    hasSecretMaterial(options.metadata) ||
    hasSecretMaterial(options.resourceRefs) ||
    hasSecretMaterial(options.runtimeConfig) ||
    hasSecretMaterial(options.env)
  ) {
    return errorResponse(c, 400, 'validation_error', 'Invalid session configuration', {
      fields: {
        metadata: 'Secret material must be stored in vault references.',
        resourceRefs: 'Resource references must not contain secret material.',
        runtimeConfig: 'Secret material must be stored in vault references.',
        env: 'Session environment variables must not contain raw secret material.',
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
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.projectId, auth.project.id)))
    .get()
  if (!agent) {
    return errorResponse(c, 404, 'not_found', 'Agent not found')
  }
  if (agent.archivedAt) {
    return errorResponse(c, 409, 'conflict', 'Archived agents cannot create sessions')
  }

  const agentVersion = await currentAgentVersion(db, agent)
  if (!agentVersion) {
    throw new Error('Agent current version is required')
  }
  const providerId = await resolveSessionProviderId(db, auth.project.id, agentVersion.providerId)
  const initialPrompt = await sessionInitialPrompt(db, auth.project.id, agent, options.initialPrompt)
  // Provider access is evaluated before any workspace, sandbox, or lease
  // work so denied requests never reach provider or runtime resources.
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
      requestId: requestId(c),
      policyCategory: policyDecision.category,
      metadata: { agentId, providerId, modelId: agentVersion.model, decision: policyDecision },
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
            : providerId,
      ruleId: policyDecision.rule,
    })
  }
  if (policyOverride) {
    // Admin override marker: the denied decision and the override flag are
    // both auditable even though the session proceeds.
    await recordAudit(db, {
      auth,
      action: 'session.create',
      resourceType: 'session',
      outcome: 'success',
      requestId: requestId(c),
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

  // Configured providers dispatch their connection details (base URL, vault
  // credential ref) into the session runtime env; a missing or disabled
  // provider blocks the session before any runtime resources are claimed.
  const providerResolution = await resolveSessionProviderConfig(db, auth.project.id, providerId)
  if (!providerResolution.ok) {
    return errorResponse(c, 409, 'conflict', 'Agent provider is not configured or unavailable for this project', {
      resourceType: 'provider',
      resourceId: providerId,
      reason: providerResolution.reason,
    })
  }
  const providerEnv = providerRuntimeEnv(providerResolution.config)
  // Provider credentials must resolve to active vault material before any
  // runtime resources are claimed; the resolution also pins the version.
  const providerSecretResolution = await resolveSecretEnvEntries(db, auth, providerEnv.secretEnv)
  if ('fields' in providerSecretResolution) {
    return errorResponse(
      c,
      409,
      'conflict',
      'Provider credential reference is not an active vault credential version',
      {
        resourceType: 'provider',
        resourceId: providerId,
      },
    )
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
  const resolvedSecretEnv = await resolveSecretEnvEntries(db, auth, options.secretEnv ?? [])
  if ('fields' in resolvedSecretEnv) {
    return errorResponse(c, 400, 'validation_error', 'Invalid session secret environment references', {
      fields: resolvedSecretEnv.fields,
    })
  }

  // Session-explicit env wins over provider-derived env, so callers can still
  // override a provider credential or base URL for a single session.
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
  // Session ids are bare UUIDs so runtimes (e.g. Claude Code) can use them
  // directly as their own session id, keeping the runtime session 1:1 with AMA.
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
    return errorResponse(c, 409, 'conflict', 'Unsupported runtime provider/model combination', {
      resourceType: 'runtime_catalog',
      runtime,
      hostingMode,
      provider: providerId,
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
    modelConfig: stringify({
      provider: providerId,
      ...(agentSnapshot.model ? { model: agentSnapshot.model } : {}),
    }),
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
    metadata: { state: pending.state, hostingMode, runtime },
  })

  if (hostingMode === 'self_hosted') {
    await enqueueSelfHostedSessionWork(c.env, db, auth, {
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
      runtimeEnv: mergedEnv,
      runtimeSecretEnv: mergedSecretEnv,
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
    env: mergedEnv,
    secretEnv: mergedSecretEnv,
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
    agentSnapshot: SerializedAgentVersion
    environmentSnapshot: NormalizedEnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    resourceRefs: Array<z.infer<typeof ResourceRefSchema>>
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
      metadata: {
        sandboxId: startedRuntime.sandboxId,
        runtimeEndpointPath: startedRuntime.runtimeEndpointPath,
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
          stateReason: null,
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

type CloudTurnOutcome =
  | { ok: true; requiresAction?: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ReturnType<typeof safeRuntimeError> }

// Per-invocation soft budget for new model turns. A queue consumer owns
// ~15 minutes of wall clock; pausing turn starts after this leaves headroom
// for one bounded (10-minute) sandbox exec to finish before the cap.
const CLOUD_TURN_SOFT_BUDGET_MS = 4 * 60_000

// Runs one cloud session turn end to end: model loop, sandbox tools, event
// persistence, idle transition, and audit. Callers are the queue consumer
// (production) and the inline path (test mode). A run that outgrows the soft
// budget is paused and re-enqueued as a session.step continuation, so total
// turn duration is not capped by one invocation.
async function executeCloudSessionTurn(
  env: Env,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.initial_prompt' | 'session.command',
): Promise<CloudTurnOutcome> {
  let approvalGateRef: ReturnType<typeof createToolApprovalGate> | null = null
  // The agent loop may wrap the denial thrown inside tool execution, so the
  // approval callback records the denial for the catch below.
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
      // Inline mode (tests) has no queue to continue on; never pause there.
      ...(cloudTurnsRunInline(env) ? {} : { shouldPause: () => Date.now() - startedAt > CLOUD_TURN_SOFT_BUDGET_MS }),
      ensureActive,
      onEvent: async (event, metadata) => {
        // A tool call paused for approval never executed: drop its synthetic
        // failure events so the continuation re-drives the same tool call
        // from clean history.
        if (approvalGate.shouldSuppressEvent(event)) {
          return
        }
        await ensureActive()
        await appendRuntimeEvent(db, {
          auth,
          sessionId: session.id,
          event,
          ...(metadata ? { metadata } : {}),
        })
      },
      resolveToolResult: (input) => approvalGate.resolveToolResult(input),
      approveToolCall: async ({ toolCallId, toolName, input }) => {
        await ensureActive()
        // Sandbox executor seam: command and outbound network tool calls are
        // gated by governance sandbox policy and the session environment
        // network policy before they reach the executor.
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
      // Keep the session running, refresh its liveness for the watchdog, and
      // chain the next step.
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
      // A governance denial fails the turn but leaves the session usable.
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

// Queue consumer entry: re-resolve the session, skip if its state moved on
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
      resourceRefs: message.resourceRefs as never,
      env: message.runtimeEnv,
      secretEnv: message.runtimeSecretEnv,
      ...(message.initialPrompt !== undefined ? { initialPrompt: message.initialPrompt } : {}),
    })
    return
  }
  if (message.type === 'session.step') {
    // Continuations only run while the session is still running; a stop or
    // error in between drops the chain.
    if (session.state !== 'running') {
      return
    }
    await executeCloudSessionTurn(env, db, auth, session, { continuation: true }, message.auditAction)
    return
  }
  // A prompt accepted while another turn was finishing can find the session
  // back in "idle": the finishing turn's idle write races the prompt's
  // running write. The queued prompt is still valid — re-mark and run it.
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

type PromptDispatchOutcome =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: ReturnType<typeof safeRuntimeError> }
  | { ok: true; delivery: (typeof MESSAGE_DELIVERIES)[number]; state: (typeof MESSAGE_STATES)[number] }

async function dispatchSessionPrompt(
  env: Env,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  content: string,
): Promise<PromptDispatchOutcome> {
  if (session.state !== 'idle' && session.state !== 'running') {
    return { ok: false, status: 409, message: 'Session runtime is not active' }
  }
  if (!session.sandboxId) {
    const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    if (
      runtimeSupportsLivePrompts(sessionRuntimeFromMetadata(metadata)) &&
      (await hasAcceptedRunnerSessionChannel(env, session.id))
    ) {
      // The lease channel Durable Object only delivers when the connected
      // runner still owns an active lease for this session, so a successful
      // dispatch reaches the live runtime; otherwise queue so the prompt is
      // never lost. The runner channel protocol keeps its `message` field.
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
    return await queueSelfHostedSessionPrompt(env, db, auth, session, content)
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
  env: Env,
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
  await enqueueSelfHostedSessionWork(env, db, auth, {
    session,
    agentSnapshot,
    environmentSnapshot,
    runtime: sessionRuntimeFromMetadata(sessionMetadata),
    runtimeConfig: sessionRuntimeConfig(sessionMetadata),
    resourceRefs: parseJson<Array<z.infer<typeof ResourceRefSchema>>>(session.resourceRefs) ?? [],
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
  return await insertCanonicalSessionEvent(
    db,
    {
      organizationId: values.auth.organization.id,
      projectId: values.auth.project.id,
      sessionId: values.sessionId,
    },
    canonicalEvent,
  )
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
  if (session.state === 'stopped') {
    return c.json(serializeSession(session), 200)
  }
  if (!session.sandboxId) {
    return await stopSelfHostedSession(c, db, auth, session, reason)
  }

  const stoppingAt = now()
  await db
    .update(sessions)
    .set({ state: 'stopped', updatedAt: stoppingAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))

  try {
    await stopCloudSessionRuntime(c.env, session.sandboxId)
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
      requestId: requestId(c),
      sessionId: session.id,
      metadata: { runtime: safeError },
    })
    return errorResponse(c, 409, 'conflict', 'Session runtime could not be stopped', { runtime: safeError })
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
    requestId: requestId(c),
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
  // Tell the owning runner to abort the live runtime handle over the accepted
  // session channel before tearing down leases; an inactive channel is fine —
  // queued work below is cancelled either way.
  await dispatchRunnerSessionCommand(c.env, session.id, { type: 'stop', reason })
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
        .set({
          state: 'cancelled',
          updatedAt: stoppedAt,
        })
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
    requestId: requestId(c),
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
  return c.json(serializeSession(stopped), 200)
}

// Archiving is lifecycle, not state (docs/api-v1-design.md §1.3): a live
// runtime is stopped first, then archivedAt is set while state stays as the
// stop left it.
async function archiveSession(c: Context<{ Bindings: Env }>, db: Db, auth: AuthContext, session: SessionRow) {
  if (session.sandboxId && session.state !== 'stopped') {
    const stoppedResponse = await stopSession(c, db, auth, session)
    if (!stoppedResponse.ok) {
      return stoppedResponse
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
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { archivedAt },
  })
  const archived = await findSession(db, auth, session.id)
  if (!archived) {
    throw new Error('Archived session row is required')
  }
  return c.json(serializeSession(archived), 200)
}

async function unarchiveSession(c: Context<{ Bindings: Env }>, db: Db, auth: AuthContext, session: SessionRow) {
  const timestamp = now()
  await db
    .update(sessions)
    .set({ archivedAt: null, updatedAt: timestamp })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.unarchive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: {},
  })
  const restored = await findSession(db, auth, session.id)
  if (!restored) {
    throw new Error('Unarchived session row is required')
  }
  return c.json(serializeSession(restored), 200)
}

function mergeMetadataUpdate(current: Record<string, unknown>, update: Record<string, unknown>) {
  return Object.fromEntries(Object.entries({ ...current, ...update }).filter(([key]) => update[key] !== null))
}

// ── Runner lease authentication for event ingest ────────────────────────────
// POST /{sessionId}/events accepts a runner OIDC token only while the runner
// holds an active, unexpired lease whose work item is attached to the session.

async function activeSessionLeaseForRunnerAuth(db: Db, auth: AuthContext, sessionId: string) {
  const identityFilters = [
    auth.oidc.runnerId ? eq(runners.id, auth.oidc.runnerId) : undefined,
    eq(runners.oidcSubject, auth.oidc.subject),
  ].filter((filter) => filter !== undefined)
  const candidateRunners = await db
    .select({ id: runners.id })
    .from(runners)
    .where(and(eq(runners.projectId, auth.project.id), or(...identityFilters)))
  const candidateIds = candidateRunners.map((runner) => runner.id)
  if (candidateIds.length === 0) {
    return null
  }
  const rows = await db
    .select({
      leaseId: leases.id,
      leaseRunnerId: leases.runnerId,
      expiresAt: leases.expiresAt,
      workItemId: workItems.id,
      workItemState: workItems.state,
      workItemLeaseId: workItems.leaseId,
      workItemRunnerId: workItems.runnerId,
      payload: workItems.payload,
    })
    .from(leases)
    .innerJoin(workItems, eq(leases.workItemId, workItems.id))
    .where(
      and(
        eq(leases.projectId, auth.project.id),
        eq(leases.state, 'active'),
        inArray(leases.runnerId, candidateIds),
        eq(workItems.sessionId, sessionId),
      ),
    )
  const timestamp = now()
  const owned = rows.find(
    (row) =>
      row.expiresAt > timestamp &&
      row.workItemState === 'leased' &&
      row.workItemLeaseId === row.leaseId &&
      row.workItemRunnerId === row.leaseRunnerId,
  )
  if (!owned) {
    return null
  }
  const payload = parseJson<Record<string, unknown>>(owned.payload) ?? {}
  return {
    runnerId: owned.leaseRunnerId,
    leaseId: owned.leaseId,
    workItemId: owned.workItemId,
    ...(typeof payload.runtime === 'string' ? { runtime: payload.runtime } : {}),
    ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
    ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
  }
}

// requireAuth path-gates runner tokens away from non-runner resources, but
// the v1 design routes runner event upload through the sessions domain
// (docs/api-v1-design.md §2 Runners), so this endpoint resolves the auth
// context itself and applies lease ownership as the runner gate.
async function requireSessionEventsAuth(c: Context<{ Bindings: Env }>, db: Parameters<typeof resolveAuthContext>[1]) {
  let auth: AuthContext | null
  try {
    auth = await resolveAuthContext(c, db)
  } catch (err) {
    if (err instanceof OidcError) {
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_bearer_token',
      })
    }
    throw err
  }
  if (!auth) {
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_bearer_token',
    })
  }
  return auth
}

// ── Events content representations ──────────────────────────────────────────

type EventsQuery = z.infer<typeof EventsQuerySchema>

function eventFilters(sessionId: string, query: EventsQuery, order: EventOrder) {
  return [
    eq(sessionEvents.sessionId, sessionId),
    eventCursorFilter(query, order),
    eventTypeFilter(query.type),
    eq(sessionEvents.visibility, query.visibility ?? 'runtime'),
    query.createdFrom ? gte(sessionEvents.createdAt, query.createdFrom) : undefined,
    query.createdTo ? lte(sessionEvents.createdAt, query.createdTo) : undefined,
  ].filter((filter) => filter !== undefined)
}

async function eventsJsonResponse(c: Context<{ Bindings: Env }>, db: Db, sessionId: string, query: EventsQuery) {
  const { limit = 100 } = query
  const order = eventOrder(query.order)
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(and(...eventFilters(sessionId, query, order)))
    .orderBy(eventOrderBy(order))
    .limit(limit + 1)
  const page = paginateSequenceRows(rows, limit)
  return c.json({ data: page.data.map(serializeEvent), pagination: page.pagination }, 200)
}

async function eventsCsvResponse(c: Context<{ Bindings: Env }>, db: Db, sessionId: string, query: EventsQuery) {
  const { limit = 200 } = query
  const order = eventOrder(query.order)
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(and(...eventFilters(sessionId, query, order)))
    .orderBy(eventOrderBy(order))
    .limit(limit)
  const header = [
    'id',
    'sessionId',
    'sequence',
    'type',
    'visibility',
    'role',
    'correlationId',
    'parentEventId',
    'createdAt',
    'payload',
    'metadata',
  ]
  const csvRows = rows
    .map(serializeEvent)
    .map((event) => [
      event.id,
      event.sessionId,
      String(event.sequence),
      event.type,
      event.visibility,
      event.role ?? '',
      event.correlationId ?? '',
      event.parentEventId ?? '',
      event.createdAt,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata),
    ])
  return csvResponse(c, `session-${sessionId}-events.csv`, header, csvRows)
}

function eventsSseResponse(c: Context<{ Bindings: Env }>, db: Db, sessionId: string, query: EventsQuery) {
  const { limit = 200 } = query
  const order = eventOrder(query.order)
  if (order === 'desc') {
    return errorResponse(c, 400, 'validation_error', 'Descending order is not supported for live event streams', {
      fields: { order: 'Use order=asc for event streams or the JSON representation for finite historical pages.' },
    })
  }

  const encoder = new TextEncoder()
  let lastSequence = query.cursor ?? 0
  const stream = new ReadableStream({
    async start(controller) {
      const deadline = Date.now() + 1000
      while (Date.now() <= deadline) {
        const rows = await db
          .select()
          .from(sessionEvents)
          .where(and(...eventFilters(sessionId, { ...query, cursor: lastSequence }, order)))
          .orderBy(eventOrderBy(order))
          .limit(limit)
        for (const row of rows) {
          lastSequence = row.sequence
          const event = serializeEvent(row)
          controller.enqueue(
            encoder.encode(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          )
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
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
}

// ── Routes ───────────────────────────────────────────────────────────────────

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
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
  summary: 'Update a session',
  description:
    'Partial update: title and metadata edits, the stop transition (state: "stopped"), and lifecycle archiving (archived: true|false).',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateSessionSchema } } },
  },
  responses: {
    200: { description: 'Updated session', content: { 'application/json': { schema: SessionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionConnectionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/connection',
  operationId: 'readSessionConnection',
  tags: ['Sessions'],
  summary: 'Read session runtime connection details',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Connection details', content: { 'application/json': { schema: SessionConnectionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionMessagesRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/messages',
  operationId: 'listSessionMessages',
  tags: ['Sessions'],
  summary: 'List session messages',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: MessageListQuerySchema },
  responses: {
    200: {
      description: 'Session messages',
      content: { 'application/json': { schema: SessionMessageListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionMessageRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/messages',
  operationId: 'createSessionMessage',
  tags: ['Sessions'],
  summary: 'Send a prompt message to a session',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateSessionMessageSchema } } },
  },
  responses: {
    201: { description: 'Message accepted', content: { 'application/json': { schema: SessionMessageSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Runtime error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionMessageRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/messages/{messageId}',
  operationId: 'readSessionMessage',
  tags: ['Sessions'],
  summary: 'Read a session message delivery state',
  ...AuthenticatedOperation,
  request: { params: MessageParamsSchema },
  responses: {
    200: { description: 'Session message', content: { 'application/json': { schema: SessionMessageSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or message not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events',
  operationId: 'listSessionEvents',
  tags: ['Sessions'],
  summary: 'List session events',
  description:
    'Content negotiation: application/json returns a paginated list, text/csv exports the filtered events, text/event-stream streams new events as SSE.',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session events',
      content: {
        'application/json': { schema: SessionEventListResponseSchema },
        'text/csv': { schema: z.string() },
        'text/event-stream': { schema: z.string() },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionEventsRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/events',
  operationId: 'createSessionEvents',
  tags: ['Sessions'],
  summary: 'Batch-create session events',
  description:
    'Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an active lease attached to the session.',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateSessionEventsSchema } } },
  },
  responses: {
    201: { description: 'Events accepted', content: { 'application/json': { schema: SessionEventsAcceptedSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionApprovalsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/approvals',
  operationId: 'listSessionApprovals',
  tags: ['Sessions'],
  summary: 'List tool approvals for a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: {
      description: 'Session approvals',
      content: { 'application/json': { schema: SessionApprovalListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionApprovalRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/approvals/{approvalId}',
  operationId: 'readSessionApproval',
  tags: ['Sessions'],
  summary: 'Read a tool approval',
  ...AuthenticatedOperation,
  request: { params: ApprovalParamsSchema },
  responses: {
    200: { description: 'Session approval', content: { 'application/json': { schema: SessionApprovalSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or approval not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const decideSessionApprovalRoute = createRoute({
  method: 'patch',
  path: '/{sessionId}/approvals/{approvalId}',
  operationId: 'decideSessionApproval',
  tags: ['Sessions'],
  summary: 'Approve or deny a pending tool call',
  description:
    'Records the human decision for a paused tool call. Approval resumes the runtime and executes the tool (or records the provided custom result); denial resumes the runtime with the denial.',
  ...AuthenticatedOperation,
  request: {
    params: ApprovalParamsSchema,
    body: { required: true, content: { 'application/json': { schema: SessionApprovalDecisionSchema } } },
  },
  responses: {
    200: { description: 'Decision recorded', content: { 'application/json': { schema: SessionApprovalSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or pending approval not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: { description: 'Approval already decided', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(createSessionRoute, async (c) => {
    const {
      agentId,
      environmentId,
      title,
      metadata,
      resourceRefs,
      runtime,
      runtimeConfig,
      env,
      secretEnv,
      initialPrompt,
      providerAccessOverride,
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
      runtime,
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(secretEnv !== undefined ? { secretEnv } : {}),
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      ...(providerAccessOverride !== undefined ? { providerAccessOverride } : {}),
    })
  })
  .openapi(listSessionsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await markExpiredPendingSessions(db, auth)

    const { archived, state, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
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
      archived === 'true' ? isNotNull(sessions.archivedAt) : isNull(sessions.archivedAt),
      state ? eq(sessions.state, state) : undefined,
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
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    let session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }

    if (session.archivedAt) {
      if (
        body.archived === false &&
        body.title === undefined &&
        body.metadata === undefined &&
        body.state === undefined
      ) {
        return await unarchiveSession(c, db, auth, session)
      }
      return errorResponse(c, 409, 'conflict', 'Archived sessions cannot be updated')
    }

    if (body.title !== undefined || body.metadata !== undefined) {
      if (hasSecretMaterial(body.metadata)) {
        return errorResponse(c, 400, 'validation_error', 'Invalid session metadata', {
          fields: { metadata: 'Secret material must be stored in vault references.' },
        })
      }
      const timestamp = now()
      const metadata =
        body.metadata !== undefined
          ? stringify(mergeMetadataUpdate(parseJson<Record<string, unknown>>(session.metadata) ?? {}, body.metadata))
          : session.metadata
      await db
        .update(sessions)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          metadata,
          updatedAt: timestamp,
        })
        .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
      session = await findSession(db, auth, sessionId)
      if (!session) {
        throw new Error('Updated session row is required')
      }
    }

    if (body.state === 'stopped') {
      const stoppedResponse = await stopSession(c, db, auth, session)
      if (!stoppedResponse.ok || body.archived !== true) {
        return stoppedResponse
      }
      session = await findSession(db, auth, sessionId)
      if (!session) {
        throw new Error('Stopped session row is required')
      }
    }

    if (body.archived === true) {
      return await archiveSession(c, db, auth, session)
    }

    return c.json(serializeSession(session), 200)
  })
  .openapi(readSessionConnectionRoute, async (c) => {
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
    return c.json(serializeSessionConnection(session), 200)
  })
  .openapi(listSessionMessagesRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const { limit = 50, cursor } = c.req.valid('query')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(sessionMessages.sessionId, sessionId),
      eq(sessionMessages.projectId, auth.project.id),
      parsedCursor
        ? or(
            lt(sessionMessages.createdAt, parsedCursor.createdAt),
            and(eq(sessionMessages.createdAt, parsedCursor.createdAt), lt(sessionMessages.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(sessionMessages)
      .where(and(...filters))
      .orderBy(desc(sessionMessages.createdAt), desc(sessionMessages.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeMessage), pagination: page.pagination }, 200)
  })
  .openapi(createSessionMessageRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const { content } = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    if (session.archivedAt) {
      return errorResponse(c, 409, 'conflict', 'Archived sessions cannot accept messages')
    }
    const outcome = await dispatchSessionPrompt(c.env, db, auth, session, content)
    if (!outcome.ok) {
      return errorResponse(c, outcome.status, outcome.status === 500 ? 'internal_error' : 'conflict', outcome.message, {
        ...(outcome.runtimeError ? { runtime: outcome.runtimeError } : {}),
      })
    }
    const timestamp = now()
    const row = {
      id: newId('msg'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      sessionId: session.id,
      type: 'prompt',
      content,
      delivery: outcome.delivery,
      state: outcome.state,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(sessionMessages).values(row)
    return c.json(serializeMessage(row), 201)
  })
  .openapi(readSessionMessageRoute, async (c) => {
    const { sessionId, messageId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    const message = await db
      .select()
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.id, messageId),
          eq(sessionMessages.sessionId, sessionId),
          eq(sessionMessages.projectId, auth.project.id),
        ),
      )
      .get()
    if (!message) {
      return errorResponse(c, 404, 'not_found', 'Session message not found')
    }
    return c.json(serializeMessage(message), 200)
  })
  .openapi(listEventsRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const query = c.req.valid('query')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    const mediaType = negotiateMediaType(c, ['text/csv', 'text/event-stream'] as const)
    if (mediaType === 'text/csv') {
      return (await eventsCsvResponse(c, db, sessionId, query)) as never
    }
    if (mediaType === 'text/event-stream') {
      return eventsSseResponse(c, db, sessionId, query) as never
    }
    return await eventsJsonResponse(c, db, sessionId, query)
  })
  .openapi(createSessionEventsRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const { events } = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireSessionEventsAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }

    let runnerLeaseMetadata: Record<string, unknown> | null = null
    if (isRunnerOidcAuth(c.env, auth)) {
      const ownedLease = await activeSessionLeaseForRunnerAuth(db, auth, sessionId)
      if (!ownedLease) {
        return errorResponse(c, 403, 'forbidden', 'Runner token does not hold an active lease for this session')
      }
      runnerLeaseMetadata = ownedLease
    }

    for (const event of events) {
      const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
        { type: event.type, ...event.payload },
        runnerLeaseMetadata
          ? { source: 'self-hosted-runner', ...(event.metadata ?? {}), ...runnerLeaseMetadata }
          : { source: 'api', ...(event.metadata ?? {}) },
      )
      await insertCanonicalSessionEvent(
        db,
        {
          organizationId: session.organizationId ?? auth.organization.id,
          projectId: auth.project.id,
          sessionId: session.id,
        },
        canonicalEvent,
      )
    }
    return c.json({ accepted: events.length }, 201)
  })
  .openapi(listSessionApprovalsRoute, async (c) => {
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
    const { pending } = sessionApprovalState(parseJson<Record<string, unknown>>(session.metadata) ?? {})
    const decided = await db
      .select()
      .from(sessionApprovals)
      .where(and(eq(sessionApprovals.sessionId, sessionId), eq(sessionApprovals.projectId, auth.project.id)))
      .orderBy(desc(sessionApprovals.createdAt), desc(sessionApprovals.id))
    const data = [
      ...(pending ? [serializePendingApproval(sessionId, pending)] : []),
      ...decided.map(serializeApprovalRow),
    ]
    return c.json({ data, pagination: { limit: data.length, nextCursor: null, hasMore: false } }, 200)
  })
  .openapi(readSessionApprovalRoute, async (c) => {
    const { sessionId, approvalId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    const decided = await db
      .select()
      .from(sessionApprovals)
      .where(
        and(
          eq(sessionApprovals.id, approvalId),
          eq(sessionApprovals.sessionId, sessionId),
          eq(sessionApprovals.projectId, auth.project.id),
        ),
      )
      .get()
    if (decided) {
      return c.json(serializeApprovalRow(decided), 200)
    }
    const { pending } = sessionApprovalState(parseJson<Record<string, unknown>>(session.metadata) ?? {})
    if (pending?.id === approvalId) {
      return c.json(serializePendingApproval(sessionId, pending), 200)
    }
    return errorResponse(c, 404, 'not_found', 'Session approval not found')
  })
  .openapi(decideSessionApprovalRoute, async (c) => {
    const { sessionId, approvalId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const session = await findSession(db, auth, sessionId)
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    const { pending } = sessionApprovalState(parseJson<Record<string, unknown>>(session.metadata) ?? {})
    if (!pending) {
      const alreadyDecided = await db
        .select()
        .from(sessionApprovals)
        .where(
          and(
            eq(sessionApprovals.id, approvalId),
            eq(sessionApprovals.sessionId, sessionId),
            eq(sessionApprovals.projectId, auth.project.id),
          ),
        )
        .get()
      if (alreadyDecided) {
        return errorResponse(c, 409, 'conflict', 'Approval is already decided')
      }
      return errorResponse(c, 404, 'not_found', 'No pending approval for the session')
    }
    if (pending.id !== approvalId) {
      return errorResponse(c, 409, 'conflict', 'Approval is no longer pending')
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
    // Persist the decided approval so it stays addressable after the pending
    // marker is cleared from the session metadata.
    const decidedAt = now()
    const approvalRow = {
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
    // Complete the paused tool call so the runtime history ends on a tool
    // result the loop can continue from: execute the approved tool (or adopt
    // the caller-provided result), and record a denial result otherwise.
    let resultOutput: Record<string, unknown>
    let resultIsError = false
    if (approved && body.result) {
      resultOutput = body.result
    } else if (approved) {
      const executed = await toolExecutor(c.env).execute({
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
    // Resume the run: the continuation picks the history up from the
    // recorded tool result.
    await db
      .update(sessions)
      .set({ state: 'running', stateReason: null, updatedAt: now() })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    const resumed = await findSession(db, auth, session.id)
    if (!resumed) {
      throw new Error('Session row is required after approval decision')
    }
    if (cloudTurnsRunInline(c.env)) {
      await executeCloudSessionTurn(c.env, db, auth, resumed, { continuation: true }, 'session.command')
    } else {
      await enqueueCloudTurn(c.env, {
        type: 'session.step',
        sessionId: session.id,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        auditAction: 'session.command',
      })
    }
    return c.json(serializeApprovalRow(approvalRow), 200)
  })

export default routes
