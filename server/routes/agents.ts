import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { agentMemories, agents, agentVersions, connections, providerModels, providers } from '../db/schema'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'
import { resolveEffectivePolicy } from '../policy'

const app = createApiRouter()

const BLOCKED_TOOLS = new Set(['secrets.read', 'filesystem.host', 'network.raw'])
const TOOL_APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

const JsonObjectSchema = z.record(z.string(), z.unknown())
const HandoffPolicySchema = JsonObjectSchema.openapi({
  example: { enabled: true, targets: [{ role: 'reviewer' }, { capability: 'code-review' }] },
})
const MemoryPolicySchema = JsonObjectSchema.openapi({
  example: { enabled: true, mode: 'notebook', scope: 'project_agent' },
})

const AgentToolAttachmentSchema = z
  .object({
    name: z.string().openapi({ example: 'repo.read' }),
    description: z.string().nullable().openapi({ example: 'Read repository metadata and files.' }),
    inputSchema: JsonObjectSchema.openapi({ example: { type: 'object', properties: { repo: { type: 'string' } } } }),
    approvalMode: z.enum(TOOL_APPROVAL_MODES).openapi({ example: 'project_policy' }),
    policyMetadata: JsonObjectSchema.openapi({ example: { sensitivity: 'low' } }),
  })
  .openapi('AgentToolAttachment')

const AgentToolAttachmentInputSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'repo.read' }),
    description: z.string().max(1000).nullable().optional().openapi({ example: 'Read repository metadata and files.' }),
    inputSchema: JsonObjectSchema.optional().openapi({
      example: { type: 'object', properties: { repo: { type: 'string' } } },
    }),
    approvalMode: z.enum(TOOL_APPROVAL_MODES).optional().openapi({ example: 'project_policy' }),
    policyMetadata: JsonObjectSchema.optional().openapi({ example: { sensitivity: 'low' } }),
  })
  .strict()
  .openapi('AgentToolAttachmentInput')

type AgentToolAttachment = z.infer<typeof AgentToolAttachmentSchema>

const AgentSchema = z
  .object({
    id: z.string().openapi({ example: 'agent_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Research assistant' }),
    description: z.string().nullable().openapi({ example: 'Answers with citations.' }),
    instructions: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    // null = resolve the project default provider at session start.
    providerId: z.string().nullable().openapi({ example: 'provider_abc123' }),
    model: z.string().nullable().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    skills: z.array(z.string()).openapi({ example: ['ama@code-review'] }),
    subagents: z.array(JsonObjectSchema).openapi({ example: [{ username: 'reviewer', role: 'reviewer' }] }),
    role: z.string().nullable().openapi({ example: 'maintainer' }),
    capabilityTags: z.array(z.string()).openapi({ example: ['issue-triage', 'code-review'] }),
    handoffPolicy: HandoffPolicySchema,
    memoryPolicy: MemoryPolicySchema,
    tools: z.array(AgentToolAttachmentSchema),
    mcpConnectors: z.array(z.string()).openapi({ example: ['github'] }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    archivedAt: z.string().datetime().nullable().openapi({ example: null }),
    currentVersionId: z.string().nullable().openapi({ example: 'agentver_abc123' }),
    version: z.number().int().openapi({ example: 1 }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('Agent')

const AgentVersionSchema = z
  .object({
    id: z.string().openapi({ example: 'agentver_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    version: z.number().int().openapi({ example: 1 }),
    instructions: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    providerId: z.string().nullable().openapi({ example: 'provider_abc123' }),
    model: z.string().nullable().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    skills: z.array(z.string()).openapi({ example: ['ama@code-review'] }),
    subagents: z.array(JsonObjectSchema).openapi({ example: [{ username: 'reviewer', role: 'reviewer' }] }),
    role: z.string().nullable().openapi({ example: 'maintainer' }),
    capabilityTags: z.array(z.string()).openapi({ example: ['issue-triage', 'code-review'] }),
    handoffPolicy: HandoffPolicySchema,
    memoryPolicy: MemoryPolicySchema,
    tools: z.array(AgentToolAttachmentSchema),
    mcpConnectors: z.array(z.string()).openapi({ example: ['github'] }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('AgentVersion')

const AgentPayloadSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Research assistant' }),
    description: z.string().max(1000).nullable().optional().openapi({ example: 'Answers with citations.' }),
    instructions: z.string().max(8000).nullable().optional().openapi({ example: 'Answer with citations.' }),
    providerId: z.string().min(1).nullable().optional().openapi({ example: 'provider_abc123' }),
    model: z.string().min(1).nullable().optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    skills: z
      .array(z.string().min(1).max(256))
      .max(100)
      .optional()
      .openapi({ example: ['ama@code-review'] }),
    subagents: z
      .array(JsonObjectSchema)
      .max(50)
      .optional()
      .openapi({ example: [{ username: 'reviewer', role: 'reviewer' }] }),
    role: z.string().trim().min(1).max(80).nullable().optional().openapi({ example: 'maintainer' }),
    capabilityTags: z
      .array(z.string().trim().min(1).max(80))
      .max(50)
      .optional()
      .openapi({ example: ['issue-triage', 'code-review'] }),
    handoffPolicy: HandoffPolicySchema.optional(),
    memoryPolicy: MemoryPolicySchema.optional(),
    tools: z.array(AgentToolAttachmentInputSchema).max(100).optional(),
    mcpConnectors: z
      .array(z.string().min(1).max(120))
      .max(50)
      .optional()
      .openapi({ example: ['github'] }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
  })
  .strict()

const CreateAgentSchema = AgentPayloadSchema.openapi('CreateAgentRequest')
const UpdateAgentSchema = AgentPayloadSchema.partial()
  .extend({
    archived: z.boolean().optional().openapi({
      description: 'Lifecycle transition: true archives the agent, false unarchives it.',
      example: false,
    }),
  })
  .strict()
  .openapi('UpdateAgentRequest')

const AgentParamsSchema = z.object({
  agentId: z.string().openapi({
    param: { name: 'agentId', in: 'path' },
    example: 'agent_abc123',
  }),
})

const AgentVersionParamsSchema = AgentParamsSchema.extend({
  version: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({
      param: { name: 'version', in: 'path' },
      example: 1,
    }),
})

const ListQuerySchema = listQuerySchema()
const AgentListResponseSchema = listResponseSchema('AgentListResponse', AgentSchema)
const AgentVersionListResponseSchema = listResponseSchema('AgentVersionListResponse', AgentVersionSchema)
const HandoffCandidateQuerySchema = z.object({
  role: z.string().trim().min(1).max(80).optional().openapi({ example: 'worker' }),
  capability: z.string().trim().min(1).max(80).optional().openapi({ example: 'implementation' }),
})
const AgentHandoffCandidateSchema = z
  .object({
    id: z.string().openapi({ example: 'agent_def456' }),
    name: z.string().openapi({ example: 'Implementation worker' }),
    role: z.string().nullable().openapi({ example: 'worker' }),
    capabilityTags: z.array(z.string()).openapi({ example: ['implementation'] }),
  })
  .openapi('AgentHandoffCandidate')
const AgentHandoffCandidateListResponseSchema = listResponseSchema(
  'AgentHandoffCandidateListResponse',
  AgentHandoffCandidateSchema,
)
const AgentMemorySchema = z
  .object({
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    content: z.string().openapi({ example: 'Previous heartbeat checked open PRs and deferred billing export.' }),
    metadata: JsonObjectSchema.openapi({ example: { format: 'markdown' } }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('AgentMemory')
const ReplaceAgentMemorySchema = z
  .object({
    content: z.string().max(128_000).openapi({
      example: 'Checked stale tasks. Follow up on repo resource migration next heartbeat.',
    }),
    metadata: JsonObjectSchema.optional().openapi({ example: { format: 'markdown' } }),
  })
  .strict()
  .openapi('ReplaceAgentMemoryRequest')

type AgentRow = typeof agents.$inferSelect
type AgentVersionRow = typeof agentVersions.$inferSelect
type AgentMemoryRow = typeof agentMemories.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } }
}

// The provider is a /providers resource reference. A null providerId defers
// resolution of the project default provider to session start.
async function validateProviderRef(
  db: ReturnType<typeof drizzle>,
  projectId: string,
  providerId: string | null,
  model: string | null,
) {
  if (!providerId) {
    return null
  }
  const provider = await db
    .select({ enabled: providers.enabled })
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.projectId, projectId)))
    .get()
  if (!provider?.enabled) {
    return { providerId: 'Provider is disabled or unavailable for this project.' }
  }
  if (model) {
    const known = await db
      .select({ id: providerModels.id })
      .from(providerModels)
      .where(
        and(
          eq(providerModels.providerId, providerId),
          eq(providerModels.projectId, projectId),
          eq(providerModels.modelId, model),
          eq(providerModels.availability, 'available'),
        ),
      )
      .get()
    if (!known) {
      return { model: 'Model is not available for this provider.' }
    }
  }
  return null
}

function normalizeToolAttachments(tools: z.infer<typeof AgentToolAttachmentInputSchema>[]): AgentToolAttachment[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? {},
    approvalMode: tool.approvalMode ?? 'project_policy',
    policyMetadata: tool.policyMetadata ?? {},
  }))
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function governanceBlocksTool(toolPolicy: Record<string, unknown>, toolName: string) {
  const blocked = stringList(toolPolicy.blockedTools)
  if (blocked.includes('*') || blocked.includes(toolName)) {
    return true
  }
  const allowed = stringList(toolPolicy.allowedTools)
  if (allowed.length > 0 && !allowed.includes('*') && !allowed.includes(toolName)) {
    return true
  }
  return toolPolicy.defaultEffect === 'deny'
}

// Tool attachments are validated against governance tool policy at save time so
// a policy-blocked tool never reaches an agent version snapshot.
function validateToolAttachments(tools: AgentToolAttachment[], toolPolicy: Record<string, unknown>) {
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) {
      return { tools: `Tool is attached more than once: ${tool.name}` }
    }
    names.add(tool.name)
    if (BLOCKED_TOOLS.has(tool.name) || governanceBlocksTool(toolPolicy, tool.name)) {
      return { tools: `Tool is blocked by policy: ${tool.name}` }
    }
    if (hasSecretMaterial(tool)) {
      return { tools: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

function secretString(value: string) {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:sk|ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/.test(value) ||
    value.toLowerCase().includes('raw-secret')
  )
}

function hasSecretMaterial(value: unknown): boolean {
  if (typeof value === 'string') {
    return secretString(value)
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => {
    return secretKey(key) || hasSecretMaterial(child)
  })
}

function validateSkills(skills: string[]) {
  for (const skill of skills) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}@[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(skill) ||
      /[\s?#{}"'\\]/.test(skill)
    ) {
      return { skills: `Skill must be a stable <source>@<skill> reference: ${skill}` }
    }
    if (secretString(skill)) {
      return { skills: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

function validateCapabilityTags(capabilityTags: string[]) {
  for (const tag of capabilityTags) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(tag)) {
      return { capabilityTags: `Capability tag must be a stable identifier: ${tag}` }
    }
    if (secretString(tag)) {
      return { capabilityTags: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

function mergeMetadata(current: Record<string, unknown>, update: Record<string, unknown> | undefined) {
  if (!update) {
    return current
  }
  return Object.fromEntries(Object.entries({ ...current, ...update }).filter(([key]) => update[key] !== null))
}

async function validateMcpConnectors(db: ReturnType<typeof drizzle>, projectId: string, connectorIds: string[]) {
  for (const connectorId of connectorIds) {
    const connection = await db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.projectId, projectId),
          eq(connections.connectorId, connectorId),
          eq(connections.state, 'connected'),
        ),
      )
      .get()
    if (!connection) {
      return { mcpConnectors: `MCP connector is not connected for this project: ${connectorId}` }
    }
  }
  return null
}

function serializeAgent(row: AgentRow, version: AgentVersionRow | null) {
  return {
    id: row.id,
    projectId: row.projectId ?? '',
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    providerId: row.providerId,
    model: row.model,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<Record<string, unknown>[]>(row.subagents),
    role: row.role,
    capabilityTags: parseJson<string[]>(row.capabilityTags),
    handoffPolicy: parseJson<Record<string, unknown>>(row.handoffPolicy),
    memoryPolicy: parseJson<Record<string, unknown>>(row.memoryPolicy),
    tools: parseJson<AgentToolAttachment[]>(row.tools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    archivedAt: row.archivedAt,
    currentVersionId: row.currentVersionId,
    version: version?.version ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeAgentVersion(row: AgentVersionRow) {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    instructions: row.instructions,
    providerId: row.providerId,
    model: row.model,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<Record<string, unknown>[]>(row.subagents),
    role: row.role,
    capabilityTags: parseJson<string[]>(row.capabilityTags),
    handoffPolicy: parseJson<Record<string, unknown>>(row.handoffPolicy),
    memoryPolicy: parseJson<Record<string, unknown>>(row.memoryPolicy),
    tools: parseJson<AgentToolAttachment[]>(row.tools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
  }
}

function serializeAgentMemory(row: AgentMemoryRow) {
  return {
    agentId: row.agentId,
    projectId: row.projectId,
    content: row.content,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function createAgentVersion(
  db: ReturnType<typeof drizzle>,
  agent: Pick<AgentRow, 'id' | 'projectId'>,
  values: {
    instructions: string | null
    providerId: string | null
    model: string | null
    skills: string[]
    subagents: Record<string, unknown>[]
    role: string | null
    capabilityTags: string[]
    handoffPolicy: Record<string, unknown>
    memoryPolicy: Record<string, unknown>
    tools: AgentToolAttachment[]
    mcpConnectors: string[]
    metadata: Record<string, unknown>
    createdAt: string
  },
) {
  if (!agent.projectId) {
    throw new Error('Agent project id is required')
  }

  const latest = await db
    .select({ version: agentVersions.version })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agent.id))
    .orderBy(desc(agentVersions.version))
    .limit(1)
    .get()
  const row = {
    id: newId('agentver'),
    agentId: agent.id,
    projectId: agent.projectId,
    version: (latest?.version ?? 0) + 1,
    instructions: values.instructions,
    providerId: values.providerId,
    model: values.model,
    skills: stringify(values.skills),
    subagents: stringify(values.subagents),
    role: values.role,
    capabilityTags: stringify(values.capabilityTags),
    handoffPolicy: stringify(values.handoffPolicy),
    memoryPolicy: stringify(values.memoryPolicy),
    tools: stringify(values.tools),
    mcpConnectors: stringify(values.mcpConnectors),
    metadata: stringify(values.metadata),
    createdAt: values.createdAt,
  }
  await db.insert(agentVersions).values(row)
  return row
}

async function findAgent(db: ReturnType<typeof drizzle>, agentId: string, projectId: string) {
  return await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    .get()
}

async function currentAgentVersion(db: ReturnType<typeof drizzle>, agent: AgentRow) {
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

function memoryEnabled(agent: AgentRow) {
  const memoryPolicy = parseJson<Record<string, unknown>>(agent.memoryPolicy)
  return memoryPolicy.enabled === true
}

interface HandoffTarget {
  role?: string
  capability?: string
}

function policyHandoffTargets(handoffPolicy: Record<string, unknown>): HandoffTarget[] {
  const targets = Array.isArray(handoffPolicy.targets) ? handoffPolicy.targets : []
  return targets
    .filter((target): target is Record<string, unknown> => Boolean(target) && typeof target === 'object')
    .map((target) => ({
      ...(typeof target.role === 'string' && target.role ? { role: target.role } : {}),
      ...(typeof target.capability === 'string' && target.capability ? { capability: target.capability } : {}),
    }))
    .filter((target) => target.role !== undefined || target.capability !== undefined)
}

function matchesHandoffTarget(targets: HandoffTarget[], candidate: AgentRow) {
  const capabilityTags = parseJson<string[]>(candidate.capabilityTags)
  return targets.some(
    (target) =>
      (target.role !== undefined && candidate.role === target.role) ||
      (target.capability !== undefined && capabilityTags.includes(target.capability)),
  )
}

function serializeHandoffCandidate(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    capabilityTags: parseJson<string[]>(row.capabilityTags),
  }
}

const listAgentsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listAgents',
  tags: ['Agents'],
  summary: 'List agents',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Agent list',
      content: { 'application/json': { schema: AgentListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createAgentRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createAgent',
  tags: ['Agents'],
  summary: 'Create an agent',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateAgentSchema } } } },
  responses: {
    201: { description: 'Created agent', content: { 'application/json': { schema: AgentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readAgentRoute = createRoute({
  method: 'get',
  path: '/{agentId}',
  operationId: 'readAgent',
  tags: ['Agents'],
  summary: 'Read an agent',
  ...AuthenticatedOperation,
  request: { params: AgentParamsSchema },
  responses: {
    200: { description: 'Agent', content: { 'application/json': { schema: AgentSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateAgentRoute = createRoute({
  method: 'patch',
  path: '/{agentId}',
  operationId: 'updateAgent',
  tags: ['Agents'],
  summary: 'Update an agent',
  description:
    'Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived: false} unarchives. Field updates on an archived agent are rejected with 409.',
  ...AuthenticatedOperation,
  request: {
    params: AgentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateAgentSchema } } },
  },
  responses: {
    200: { description: 'Updated agent', content: { 'application/json': { schema: AgentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Archived agent', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listAgentVersionsRoute = createRoute({
  method: 'get',
  path: '/{agentId}/versions',
  operationId: 'listAgentVersions',
  tags: ['Agents'],
  summary: 'List agent versions',
  ...AuthenticatedOperation,
  request: { params: AgentParamsSchema },
  responses: {
    200: {
      description: 'Agent versions',
      content: { 'application/json': { schema: AgentVersionListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readAgentVersionRoute = createRoute({
  method: 'get',
  path: '/{agentId}/versions/{version}',
  operationId: 'readAgentVersion',
  tags: ['Agents'],
  summary: 'Read an agent version',
  ...AuthenticatedOperation,
  request: { params: AgentVersionParamsSchema },
  responses: {
    200: { description: 'Agent version', content: { 'application/json': { schema: AgentVersionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Agent or version not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listAgentHandoffCandidatesRoute = createRoute({
  method: 'get',
  path: '/{agentId}/handoff-candidates',
  operationId: 'listAgentHandoffCandidates',
  tags: ['Agents'],
  summary: 'List handoff candidate agents',
  description:
    'Resolves live agents in the same project that match the requested role or capability, or the agent handoff policy targets. AMA only resolves candidates; the requesting product decides how a handoff affects its own workflow records.',
  ...AuthenticatedOperation,
  request: { params: AgentParamsSchema, query: HandoffCandidateQuerySchema },
  responses: {
    200: {
      description: 'Handoff candidates',
      content: { 'application/json': { schema: AgentHandoffCandidateListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readAgentMemoryRoute = createRoute({
  method: 'get',
  path: '/{agentId}/memory',
  operationId: 'readAgentMemory',
  tags: ['Agents'],
  summary: 'Read agent memory',
  ...AuthenticatedOperation,
  request: { params: AgentParamsSchema },
  responses: {
    200: { description: 'Agent memory', content: { 'application/json': { schema: AgentMemorySchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Agent memory disabled', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const replaceAgentMemoryRoute = createRoute({
  method: 'put',
  path: '/{agentId}/memory',
  operationId: 'replaceAgentMemory',
  tags: ['Agents'],
  summary: 'Replace agent memory',
  description: 'Idempotent whole replacement of the agent memory singleton.',
  ...AuthenticatedOperation,
  request: {
    params: AgentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: ReplaceAgentMemorySchema } } },
  },
  responses: {
    200: { description: 'Replaced agent memory', content: { 'application/json': { schema: AgentMemorySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Agent memory disabled', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(listAgentsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
    }
    const filters = [
      eq(agents.projectId, auth.project.id),
      archived === 'true' ? isNotNull(agents.archivedAt) : isNull(agents.archivedAt),
      search ? like(agents.name, `%${search}%`) : undefined,
      createdFrom ? gte(agents.createdAt, createdFrom) : undefined,
      createdTo ? lte(agents.createdAt, createdTo) : undefined,
      parsedCursor
        ? or(
            lt(agents.createdAt, parsedCursor.createdAt),
            and(eq(agents.createdAt, parsedCursor.createdAt), lt(agents.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(agents)
      .where(and(...filters))
      .orderBy(desc(agents.createdAt), desc(agents.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    const data = await Promise.all(
      page.data.map(async (row) => serializeAgent(row, await currentAgentVersion(db, row))),
    )
    return c.json({ data, pagination: page.pagination }, 200)
  })
  .openapi(createAgentRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const providerId = body.providerId ?? null
    const model = body.model ?? null
    const skills = body.skills ?? []
    const subagents = body.subagents ?? []
    const role = body.role ?? null
    const capabilityTags = body.capabilityTags ?? []
    const handoffPolicy = body.handoffPolicy ?? {}
    const memoryPolicy = body.memoryPolicy ?? { enabled: false }
    const tools = normalizeToolAttachments(body.tools ?? [])
    const mcpConnectors = body.mcpConnectors ?? []
    const metadata = body.metadata ?? {}
    const effectiveToolPolicy = tools.length > 0 ? (await resolveEffectivePolicy(db, auth)).toolPolicy : {}
    const validation =
      (await validateProviderRef(db, auth.project.id, providerId, model)) ??
      validateSkills(skills) ??
      (hasSecretMaterial(subagents) ? { subagents: 'Secret material must be stored in a vault.' } : null) ??
      validateCapabilityTags(capabilityTags) ??
      validateToolAttachments(tools, effectiveToolPolicy) ??
      (await validateMcpConnectors(db, auth.project.id, mcpConnectors)) ??
      (hasSecretMaterial(handoffPolicy) ? { handoffPolicy: 'Secret material must be stored in a vault.' } : null) ??
      (hasSecretMaterial(memoryPolicy) ? { memoryPolicy: 'Secret material must be stored in a vault.' } : null) ??
      (hasSecretMaterial(metadata) ? { metadata: 'Secret material must be stored in a vault.' } : null)
    if (validation) {
      return c.json(domainValidation('Invalid agent configuration', validation), 400)
    }

    const timestamp = now()
    const row = {
      id: newId('agent'),
      projectId: auth.project.id,
      name: body.name,
      description: body.description ?? null,
      instructions: body.instructions ?? null,
      providerId,
      model,
      skills: stringify(skills),
      subagents: stringify(subagents),
      role,
      capabilityTags: stringify(capabilityTags),
      handoffPolicy: stringify(handoffPolicy),
      memoryPolicy: stringify(memoryPolicy),
      tools: stringify(tools),
      mcpConnectors: stringify(mcpConnectors),
      metadata: stringify(metadata),
      archivedAt: null,
      currentVersionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(agents).values(row)
    const version = await createAgentVersion(db, row, {
      instructions: row.instructions,
      providerId,
      model,
      skills,
      subagents,
      role,
      capabilityTags,
      handoffPolicy,
      memoryPolicy,
      tools,
      mcpConnectors,
      metadata,
      createdAt: timestamp,
    })
    await db.update(agents).set({ currentVersionId: version.id }).where(eq(agents.id, row.id))

    return c.json(serializeAgent({ ...row, currentVersionId: version.id }, version), 201)
  })
  .openapi(readAgentRoute, async (c) => {
    const { agentId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const agent = await findAgent(db, agentId, auth.project.id)
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
    }
    return c.json(serializeAgent(agent, await currentAgentVersion(db, agent)), 200)
  })
  .openapi(updateAgentRoute, async (c) => {
    const { agentId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const agent = await findAgent(db, agentId, auth.project.id)
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
    }

    const { archived, ...fields } = body
    const hasFieldUpdates = Object.keys(fields).length > 0

    if (agent.archivedAt) {
      if (hasFieldUpdates) {
        return c.json({ error: { type: 'conflict', message: 'Archived agents cannot be updated' } }, 409)
      }
      if (archived === false) {
        const timestamp = now()
        await db
          .update(agents)
          .set({ archivedAt: null, updatedAt: timestamp })
          .where(and(eq(agents.id, agentId), eq(agents.projectId, auth.project.id)))
        await recordAudit(db, {
          auth,
          action: 'agent.unarchive',
          resourceType: 'agent',
          resourceId: agentId,
          outcome: 'success',
          requestId: requestId(c),
          before: { archivedAt: agent.archivedAt },
          after: { archivedAt: null },
        })
        const unarchived = { ...agent, archivedAt: null, updatedAt: timestamp }
        return c.json(serializeAgent(unarchived, await currentAgentVersion(db, unarchived)), 200)
      }
      // archived: true (idempotent) or an empty patch leaves the agent as is.
      return c.json(serializeAgent(agent, await currentAgentVersion(db, agent)), 200)
    }

    const next = {
      name: fields.name ?? agent.name,
      description: fields.description !== undefined ? fields.description : agent.description,
      instructions: fields.instructions !== undefined ? fields.instructions : agent.instructions,
      providerId: fields.providerId !== undefined ? fields.providerId : agent.providerId,
      model: fields.model !== undefined ? fields.model : agent.model,
      skills: fields.skills ?? parseJson<string[]>(agent.skills),
      subagents: fields.subagents ?? parseJson<Record<string, unknown>[]>(agent.subagents),
      role: fields.role !== undefined ? fields.role : agent.role,
      capabilityTags: fields.capabilityTags ?? parseJson<string[]>(agent.capabilityTags),
      handoffPolicy: fields.handoffPolicy ?? parseJson<Record<string, unknown>>(agent.handoffPolicy),
      memoryPolicy: fields.memoryPolicy ?? parseJson<Record<string, unknown>>(agent.memoryPolicy),
      tools: fields.tools ? normalizeToolAttachments(fields.tools) : parseJson<AgentToolAttachment[]>(agent.tools),
      mcpConnectors: fields.mcpConnectors ?? parseJson<string[]>(agent.mcpConnectors),
      metadata: mergeMetadata(parseJson<Record<string, unknown>>(agent.metadata), fields.metadata),
    }
    const validation =
      (await validateProviderRef(db, auth.project.id, next.providerId, next.model)) ??
      validateSkills(next.skills) ??
      (hasSecretMaterial(next.subagents) ? { subagents: 'Secret material must be stored in a vault.' } : null) ??
      validateCapabilityTags(next.capabilityTags) ??
      validateToolAttachments(
        next.tools,
        next.tools.length > 0 ? (await resolveEffectivePolicy(db, auth)).toolPolicy : {},
      ) ??
      (await validateMcpConnectors(db, auth.project.id, next.mcpConnectors)) ??
      (hasSecretMaterial(next.handoffPolicy)
        ? { handoffPolicy: 'Secret material must be stored in a vault.' }
        : null) ??
      (hasSecretMaterial(next.memoryPolicy) ? { memoryPolicy: 'Secret material must be stored in a vault.' } : null) ??
      (hasSecretMaterial(next.metadata) ? { metadata: 'Secret material must be stored in a vault.' } : null)
    if (validation) {
      return c.json(domainValidation('Invalid agent configuration', validation), 400)
    }

    const timestamp = now()
    const runtimeChanged =
      fields.instructions !== undefined ||
      fields.providerId !== undefined ||
      fields.model !== undefined ||
      fields.skills !== undefined ||
      fields.subagents !== undefined ||
      fields.role !== undefined ||
      fields.capabilityTags !== undefined ||
      fields.handoffPolicy !== undefined ||
      fields.memoryPolicy !== undefined ||
      fields.tools !== undefined ||
      fields.mcpConnectors !== undefined ||
      fields.metadata !== undefined
    const version = runtimeChanged
      ? await createAgentVersion(db, agent, { ...next, createdAt: timestamp })
      : await currentAgentVersion(db, agent)
    const archivedAt = archived === true ? timestamp : agent.archivedAt
    const updated = {
      ...next,
      skills: stringify(next.skills),
      subagents: stringify(next.subagents),
      capabilityTags: stringify(next.capabilityTags),
      handoffPolicy: stringify(next.handoffPolicy),
      memoryPolicy: stringify(next.memoryPolicy),
      tools: stringify(next.tools),
      mcpConnectors: stringify(next.mcpConnectors),
      metadata: stringify(next.metadata),
      archivedAt,
      currentVersionId: version?.id ?? agent.currentVersionId,
      updatedAt: timestamp,
    }
    await db
      .update(agents)
      .set(updated)
      .where(and(eq(agents.id, agentId), eq(agents.projectId, auth.project.id)))
    if (archived === true) {
      await recordAudit(db, {
        auth,
        action: 'agent.archive',
        resourceType: 'agent',
        resourceId: agentId,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeAgent(agent, await currentAgentVersion(db, agent)),
        after: { archivedAt: timestamp },
      })
    }

    return c.json(serializeAgent({ ...agent, ...updated }, version), 200)
  })
  .openapi(listAgentVersionsRoute, async (c) => {
    const { agentId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const agent = await findAgent(db, agentId, auth.project.id)
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
    }

    const rows = await db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.projectId, auth.project.id)))
      .orderBy(desc(agentVersions.version))
    return c.json(
      {
        data: rows.map(serializeAgentVersion),
        pagination: { limit: rows.length, nextCursor: null, hasMore: false },
      },
      200,
    )
  })
  .openapi(readAgentVersionRoute, async (c) => {
    const { agentId, version } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const agent = await findAgent(db, agentId, auth.project.id)
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
    }

    const row = await db
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, agentId),
          eq(agentVersions.projectId, auth.project.id),
          eq(agentVersions.version, version),
        ),
      )
      .get()
    if (!row) {
      return c.json({ error: { type: 'not_found', message: 'Agent version not found' } }, 404)
    }
    return c.json(serializeAgentVersion(row), 200)
  })
  .openapi(listAgentHandoffCandidatesRoute, async (c) => {
    const { agentId } = c.req.valid('param')
    const { role, capability } = c.req.valid('query')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const agent = await findAgent(db, agentId, auth.project.id)
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
    }

    const requestedTarget = {
      ...(role !== undefined ? { role } : {}),
      ...(capability !== undefined ? { capability } : {}),
    }
    const targets =
      requestedTarget.role !== undefined || requestedTarget.capability !== undefined
        ? [requestedTarget]
        : policyHandoffTargets(parseJson<Record<string, unknown>>(agent.handoffPolicy))
    if (targets.length === 0) {
      return c.json(
        domainValidation('No handoff target requested', {
          target: 'Request a role or capability, or configure handoff policy targets on the agent.',
        }),
        400,
      )
    }

    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.projectId, auth.project.id), isNull(agents.archivedAt)))
      .orderBy(desc(agents.createdAt), desc(agents.id))
    const candidates = rows
      .filter((row) => row.id !== agentId && matchesHandoffTarget(targets, row))
      .map(serializeHandoffCandidate)
    return c.json(
      {
        data: candidates,
        pagination: { limit: candidates.length, nextCursor: null, hasMore: false },
      },
      200,
    )
  })
  .openapi(readAgentMemoryRoute, async (c) => {
    const { agentId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const agent = await findAgent(db, agentId, auth.project.id)
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
    }
    if (!memoryEnabled(agent)) {
      return c.json({ error: { type: 'conflict', message: 'Agent memory is disabled' } }, 409)
    }

    const existing = await db
      .select()
      .from(agentMemories)
      .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, auth.project.id)))
      .get()
    if (existing) {
      return c.json(serializeAgentMemory(existing), 200)
    }

    const timestamp = now()
    const created = {
      agentId,
      projectId: auth.project.id,
      content: '',
      metadata: stringify({}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(agentMemories).values(created)
    return c.json(serializeAgentMemory(created), 200)
  })
  .openapi(replaceAgentMemoryRoute, async (c) => {
    const { agentId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const agent = await findAgent(db, agentId, auth.project.id)
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
    }
    if (!memoryEnabled(agent)) {
      return c.json({ error: { type: 'conflict', message: 'Agent memory is disabled' } }, 409)
    }
    const metadata = body.metadata ?? {}
    if (hasSecretMaterial(metadata)) {
      return c.json(
        domainValidation('Invalid agent memory', { metadata: 'Secret material must be stored in a vault.' }),
        400,
      )
    }

    const existing = await db
      .select()
      .from(agentMemories)
      .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, auth.project.id)))
      .get()
    const timestamp = now()
    if (!existing) {
      const created = {
        agentId,
        projectId: auth.project.id,
        content: body.content,
        metadata: stringify(metadata),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(agentMemories).values(created)
      return c.json(serializeAgentMemory(created), 200)
    }

    // PUT replaces the whole memory singleton: content and metadata are
    // overwritten, never merged.
    const replaced = {
      content: body.content,
      metadata: stringify(metadata),
      updatedAt: timestamp,
    }
    await db
      .update(agentMemories)
      .set(replaced)
      .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, auth.project.id)))
    return c.json(serializeAgentMemory({ ...existing, ...replaced }), 200)
  })

export default routes
