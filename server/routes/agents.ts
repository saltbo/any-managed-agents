import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import {
  agentDefinitions,
  agentDefinitionVersions,
  agentMemories,
  mcpConnections,
  providerConfigs,
  providerModels,
} from '../db/schema'
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

const DEFAULT_PROVIDER = 'workers-ai'
const DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.6'
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
    provider: z.string().openapi({ example: DEFAULT_PROVIDER }),
    model: z.string().nullable().openapi({ example: DEFAULT_MODEL }),
    systemPrompt: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    skills: z.array(z.string()).openapi({ example: ['ama@code-review'] }),
    subagents: z.array(JsonObjectSchema).openapi({ example: [{ username: 'reviewer', role: 'reviewer' }] }),
    role: z.string().nullable().openapi({ example: 'maintainer' }),
    capabilityTags: z.array(z.string()).openapi({ example: ['issue-triage', 'code-review'] }),
    handoffPolicy: HandoffPolicySchema,
    memoryPolicy: MemoryPolicySchema,
    allowedTools: z.array(z.string()).openapi({ example: ['web.search'] }),
    tools: z.array(AgentToolAttachmentSchema),
    mcpConnectors: z.array(z.string()).openapi({ example: ['github'] }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    status: z.enum(['active', 'archived']).openapi({ example: 'active' }),
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
    provider: z.string().openapi({ example: DEFAULT_PROVIDER }),
    model: z.string().nullable().openapi({ example: DEFAULT_MODEL }),
    systemPrompt: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    skills: z.array(z.string()).openapi({ example: ['ama@code-review'] }),
    subagents: z.array(JsonObjectSchema).openapi({ example: [{ username: 'reviewer', role: 'reviewer' }] }),
    role: z.string().nullable().openapi({ example: 'maintainer' }),
    capabilityTags: z.array(z.string()).openapi({ example: ['issue-triage', 'code-review'] }),
    handoffPolicy: HandoffPolicySchema,
    memoryPolicy: MemoryPolicySchema,
    allowedTools: z.array(z.string()).openapi({ example: ['web.search'] }),
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
    provider: z.string().min(1).optional().openapi({ example: DEFAULT_PROVIDER }),
    model: z.string().min(1).nullable().optional().openapi({ example: DEFAULT_MODEL }),
    systemPrompt: z.string().max(8000).nullable().optional().openapi({ example: 'Answer with citations.' }),
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
    allowedTools: z
      .array(z.string().min(1))
      .max(100)
      .optional()
      .openapi({ example: ['web.search'] }),
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
const UpdateAgentSchema = AgentPayloadSchema.partial().openapi('UpdateAgentRequest')

const AgentParamsSchema = z.object({
  agentId: z.string().openapi({
    param: { name: 'agentId', in: 'path' },
    example: 'agent_abc123',
  }),
})

const ListQuerySchema = listQuerySchema(['active', 'archived'])
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
    status: z.enum(['active', 'archived']).openapi({ example: 'active' }),
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
const UpdateAgentMemorySchema = z
  .object({
    content: z.string().max(128_000).optional().openapi({
      example: 'Checked stale tasks. Follow up on repo resource migration next heartbeat.',
    }),
    metadata: JsonObjectSchema.optional().openapi({ example: { format: 'markdown' } }),
  })
  .strict()
  .openapi('UpdateAgentMemoryRequest')

type AgentRow = typeof agentDefinitions.$inferSelect
type AgentVersionRow = typeof agentDefinitionVersions.$inferSelect
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

function allowedModels(envDefault: string | undefined) {
  return new Set([DEFAULT_MODEL, envDefault].filter((model): model is string => Boolean(model)))
}

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } }
}

function validateProviderModel(provider: string, model: string, envDefault: string | undefined) {
  if (provider !== DEFAULT_PROVIDER) {
    return { provider: 'Provider is not available for this project.' }
  }
  if (!allowedModels(envDefault).has(model)) {
    return { model: 'Model is not available for this provider.' }
  }
  return null
}

async function defaultProvider(db: ReturnType<typeof drizzle>, projectId: string) {
  const configured = await db
    .select({ id: providerConfigs.id, type: providerConfigs.type })
    .from(providerConfigs)
    .where(
      and(
        eq(providerConfigs.projectId, projectId),
        eq(providerConfigs.isDefault, true),
        eq(providerConfigs.status, 'active'),
      ),
    )
    .get()
  if (!configured) {
    return DEFAULT_PROVIDER
  }
  return configured.type === DEFAULT_PROVIDER ? DEFAULT_PROVIDER : configured.id
}

async function normalizeRequestedProvider(db: ReturnType<typeof drizzle>, projectId: string, provider: string) {
  if (provider === DEFAULT_PROVIDER) {
    return DEFAULT_PROVIDER
  }
  const configured = await db
    .select({ type: providerConfigs.type })
    .from(providerConfigs)
    .where(and(eq(providerConfigs.id, provider), eq(providerConfigs.projectId, projectId)))
    .get()
  return configured?.type === DEFAULT_PROVIDER ? DEFAULT_PROVIDER : provider
}

async function validateConfiguredProviderModel(
  db: ReturnType<typeof drizzle>,
  projectId: string,
  provider: string,
  model: string,
  envDefault: string | undefined,
) {
  if (provider === DEFAULT_PROVIDER) {
    const workersOverride = await db
      .select({ status: providerConfigs.status })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.projectId, projectId), eq(providerConfigs.type, DEFAULT_PROVIDER)))
      .orderBy(desc(providerConfigs.updatedAt))
      .get()
    if (workersOverride && workersOverride.status !== 'active') {
      return { provider: 'Provider is disabled or unavailable for this project.' }
    }
    return validateProviderModel(provider, model, envDefault)
  }
  const configured = await db
    .select()
    .from(providerConfigs)
    .where(and(eq(providerConfigs.id, provider), eq(providerConfigs.projectId, projectId)))
    .get()
  if (configured?.status !== 'active') {
    return { provider: 'Provider is disabled or unavailable for this project.' }
  }
  const knownModels = await db
    .select({ id: providerModels.id })
    .from(providerModels)
    .where(
      and(
        eq(providerModels.providerId, provider),
        eq(providerModels.projectId, projectId),
        eq(providerModels.modelId, model),
        eq(providerModels.availability, 'available'),
      ),
    )
  if (knownModels.length === 0) {
    return { model: 'Model is not available for this provider.' }
  }
  return null
}

function validateAllowedTools(allowedTools: string[]) {
  const blocked = allowedTools.find((tool) => BLOCKED_TOOLS.has(tool))
  if (blocked) {
    return { allowedTools: `Tool is blocked by policy: ${blocked}` }
  }
  const secret = allowedTools.find(secretString)
  return secret ? { allowedTools: 'Secret material must be stored in a vault.' } : null
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
      .select({ id: mcpConnections.id })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.projectId, projectId),
          eq(mcpConnections.connectorId, connectorId),
          eq(mcpConnections.status, 'connected'),
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
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<Record<string, unknown>[]>(row.subagents),
    role: row.role,
    capabilityTags: parseJson<string[]>(row.capabilityTags),
    handoffPolicy: parseJson<Record<string, unknown>>(row.handoffPolicy),
    memoryPolicy: parseJson<Record<string, unknown>>(row.memoryPolicy),
    allowedTools: parseJson<string[]>(row.allowedTools),
    tools: parseJson<AgentToolAttachment[]>(row.tools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    status: row.status as 'active' | 'archived',
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
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<Record<string, unknown>[]>(row.subagents),
    role: row.role,
    capabilityTags: parseJson<string[]>(row.capabilityTags),
    handoffPolicy: parseJson<Record<string, unknown>>(row.handoffPolicy),
    memoryPolicy: parseJson<Record<string, unknown>>(row.memoryPolicy),
    allowedTools: parseJson<string[]>(row.allowedTools),
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
    provider: string
    model: string | null
    systemPrompt: string | null
    skills: string[]
    subagents: Record<string, unknown>[]
    role: string | null
    capabilityTags: string[]
    handoffPolicy: Record<string, unknown>
    memoryPolicy: Record<string, unknown>
    allowedTools: string[]
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
    .select({ version: agentDefinitionVersions.version })
    .from(agentDefinitionVersions)
    .where(eq(agentDefinitionVersions.agentId, agent.id))
    .orderBy(desc(agentDefinitionVersions.version))
    .limit(1)
    .get()
  const row = {
    id: newId('agentver'),
    agentId: agent.id,
    projectId: agent.projectId,
    version: (latest?.version ?? 0) + 1,
    instructions: values.instructions,
    provider: values.provider,
    model: values.model,
    systemPrompt: values.systemPrompt,
    skills: stringify(values.skills),
    subagents: stringify(values.subagents),
    role: values.role,
    capabilityTags: stringify(values.capabilityTags),
    handoffPolicy: stringify(values.handoffPolicy),
    memoryPolicy: stringify(values.memoryPolicy),
    allowedTools: stringify(values.allowedTools),
    tools: stringify(values.tools),
    mcpConnectors: stringify(values.mcpConnectors),
    metadata: stringify(values.metadata),
    createdAt: values.createdAt,
  }
  await db.insert(agentDefinitionVersions).values(row)
  return row
}

async function findAgent(db: ReturnType<typeof drizzle>, agentId: string, projectId: string) {
  return await db
    .select()
    .from(agentDefinitions)
    .where(and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.projectId, projectId)))
    .get()
}

async function currentAgentVersion(db: ReturnType<typeof drizzle>, agent: AgentRow) {
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
    status: row.status as 'active' | 'archived',
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
  ...AuthenticatedOperation,
  request: {
    params: AgentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateAgentSchema } } },
  },
  responses: {
    200: { description: 'Updated agent', content: { 'application/json': { schema: AgentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Archived agent', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveAgentRoute = createRoute({
  method: 'delete',
  path: '/{agentId}',
  operationId: 'archiveAgent',
  tags: ['Agents'],
  summary: 'Archive an agent',
  ...AuthenticatedOperation,
  request: { params: AgentParamsSchema },
  responses: {
    204: { description: 'Agent archived' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
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

const listAgentHandoffCandidatesRoute = createRoute({
  method: 'get',
  path: '/{agentId}/handoff-candidates',
  operationId: 'listAgentHandoffCandidates',
  tags: ['Agents'],
  summary: 'List handoff candidate agents',
  description:
    'Resolves active agents in the same project that match the requested role or capability, or the agent handoff policy targets. AMA only resolves candidates; the requesting product decides how a handoff affects its own workflow records.',
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

const updateAgentMemoryRoute = createRoute({
  method: 'patch',
  path: '/{agentId}/memory',
  operationId: 'updateAgentMemory',
  tags: ['Agents'],
  summary: 'Update agent memory',
  ...AuthenticatedOperation,
  request: {
    params: AgentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateAgentMemorySchema } } },
  },
  responses: {
    200: { description: 'Updated agent memory', content: { 'application/json': { schema: AgentMemorySchema } } },
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

    const { includeArchived, status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
    }
    const statusFilter = status ?? (includeArchived === 'true' ? undefined : 'active')
    const filters = [
      eq(agentDefinitions.projectId, auth.project.id),
      statusFilter ? eq(agentDefinitions.status, statusFilter) : undefined,
      search ? like(agentDefinitions.name, `%${search}%`) : undefined,
      createdFrom ? gte(agentDefinitions.createdAt, createdFrom) : undefined,
      createdTo ? lte(agentDefinitions.createdAt, createdTo) : undefined,
      parsedCursor
        ? or(
            lt(agentDefinitions.createdAt, parsedCursor.createdAt),
            and(eq(agentDefinitions.createdAt, parsedCursor.createdAt), lt(agentDefinitions.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(agentDefinitions)
      .where(and(...filters))
      .orderBy(desc(agentDefinitions.createdAt), desc(agentDefinitions.id))
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

    const provider = await normalizeRequestedProvider(
      db,
      auth.project.id,
      body.provider ?? (await defaultProvider(db, auth.project.id)),
    )
    const model = body.model ?? null
    const skills = body.skills ?? []
    const subagents = body.subagents ?? []
    const role = body.role ?? null
    const capabilityTags = body.capabilityTags ?? []
    const handoffPolicy = body.handoffPolicy ?? {}
    const memoryPolicy = body.memoryPolicy ?? { enabled: false }
    const allowedTools = body.allowedTools ?? []
    const tools = normalizeToolAttachments(body.tools ?? [])
    const mcpConnectors = body.mcpConnectors ?? []
    const metadata = body.metadata ?? {}
    const effectiveToolPolicy = tools.length > 0 ? (await resolveEffectivePolicy(db, auth)).toolPolicy : {}
    const validation =
      (model
        ? await validateConfiguredProviderModel(db, auth.project.id, provider, model, c.env.AMA_DEFAULT_MODEL)
        : null) ??
      validateSkills(skills) ??
      (hasSecretMaterial(subagents) ? { subagents: 'Secret material must be stored in a vault.' } : null) ??
      validateCapabilityTags(capabilityTags) ??
      validateAllowedTools(allowedTools) ??
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
      instructions: body.instructions ?? body.systemPrompt ?? null,
      provider,
      model,
      systemPrompt: body.systemPrompt ?? body.instructions ?? null,
      skills: stringify(skills),
      subagents: stringify(subagents),
      role,
      capabilityTags: stringify(capabilityTags),
      handoffPolicy: stringify(handoffPolicy),
      memoryPolicy: stringify(memoryPolicy),
      allowedTools: stringify(allowedTools),
      tools: stringify(tools),
      mcpConnectors: stringify(mcpConnectors),
      metadata: stringify(metadata),
      status: 'active',
      archivedAt: null,
      currentVersionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(agentDefinitions).values(row)
    const version = await createAgentVersion(db, row, {
      ...row,
      skills,
      subagents,
      role,
      capabilityTags,
      handoffPolicy,
      memoryPolicy,
      allowedTools,
      tools,
      mcpConnectors,
      metadata,
      createdAt: timestamp,
    })
    await db.update(agentDefinitions).set({ currentVersionId: version.id }).where(eq(agentDefinitions.id, row.id))

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
    if (agent.status === 'archived') {
      return c.json({ error: { type: 'conflict', message: 'Archived agents cannot be updated' } }, 409)
    }

    const next = {
      name: body.name ?? agent.name,
      description: body.description !== undefined ? body.description : agent.description,
      instructions: body.instructions !== undefined ? body.instructions : agent.instructions,
      provider: await normalizeRequestedProvider(db, auth.project.id, body.provider ?? agent.provider),
      model: body.model !== undefined ? body.model : agent.model,
      systemPrompt: body.systemPrompt !== undefined ? body.systemPrompt : agent.systemPrompt,
      skills: body.skills ?? parseJson<string[]>(agent.skills),
      subagents: body.subagents ?? parseJson<Record<string, unknown>[]>(agent.subagents),
      role: body.role !== undefined ? body.role : agent.role,
      capabilityTags: body.capabilityTags ?? parseJson<string[]>(agent.capabilityTags),
      handoffPolicy: body.handoffPolicy ?? parseJson<Record<string, unknown>>(agent.handoffPolicy),
      memoryPolicy: body.memoryPolicy ?? parseJson<Record<string, unknown>>(agent.memoryPolicy),
      allowedTools: body.allowedTools ?? parseJson<string[]>(agent.allowedTools),
      tools: body.tools ? normalizeToolAttachments(body.tools) : parseJson<AgentToolAttachment[]>(agent.tools),
      mcpConnectors: body.mcpConnectors ?? parseJson<string[]>(agent.mcpConnectors),
      metadata: mergeMetadata(parseJson<Record<string, unknown>>(agent.metadata), body.metadata),
    }
    const validation =
      (next.model
        ? await validateConfiguredProviderModel(db, auth.project.id, next.provider, next.model, c.env.AMA_DEFAULT_MODEL)
        : null) ??
      validateSkills(next.skills) ??
      (hasSecretMaterial(next.subagents) ? { subagents: 'Secret material must be stored in a vault.' } : null) ??
      validateCapabilityTags(next.capabilityTags) ??
      validateAllowedTools(next.allowedTools) ??
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
      body.instructions !== undefined ||
      body.provider !== undefined ||
      body.model !== undefined ||
      body.systemPrompt !== undefined ||
      body.skills !== undefined ||
      body.subagents !== undefined ||
      body.role !== undefined ||
      body.capabilityTags !== undefined ||
      body.handoffPolicy !== undefined ||
      body.memoryPolicy !== undefined ||
      body.allowedTools !== undefined ||
      body.tools !== undefined ||
      body.mcpConnectors !== undefined ||
      body.metadata !== undefined
    const version = runtimeChanged
      ? await createAgentVersion(db, agent, { ...next, createdAt: timestamp })
      : await currentAgentVersion(db, agent)
    const updated = {
      ...next,
      skills: stringify(next.skills),
      subagents: stringify(next.subagents),
      role: next.role,
      capabilityTags: stringify(next.capabilityTags),
      handoffPolicy: stringify(next.handoffPolicy),
      memoryPolicy: stringify(next.memoryPolicy),
      allowedTools: stringify(next.allowedTools),
      tools: stringify(next.tools),
      mcpConnectors: stringify(next.mcpConnectors),
      metadata: stringify(next.metadata),
      currentVersionId: version?.id ?? agent.currentVersionId,
      updatedAt: timestamp,
    }
    await db
      .update(agentDefinitions)
      .set(updated)
      .where(and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.projectId, auth.project.id)))

    return c.json(serializeAgent({ ...agent, ...updated }, version), 200)
  })
  .openapi(archiveAgentRoute, async (c) => {
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

    const timestamp = now()
    await db
      .update(agentDefinitions)
      .set({ status: 'archived', archivedAt: timestamp, updatedAt: timestamp })
      .where(and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.projectId, auth.project.id)))
    await recordAudit(db, {
      auth,
      action: 'agent.archive',
      resourceType: 'agent',
      resourceId: agentId,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeAgent(agent, await currentAgentVersion(db, agent)),
      after: { status: 'archived', archivedAt: timestamp },
    })
    return c.body(null, 204)
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
      .from(agentDefinitionVersions)
      .where(and(eq(agentDefinitionVersions.agentId, agentId), eq(agentDefinitionVersions.projectId, auth.project.id)))
      .orderBy(desc(agentDefinitionVersions.version))
    return c.json(
      {
        data: rows.map(serializeAgentVersion),
        pagination: {
          limit: rows.length,
          nextCursor: null,
          hasMore: false,
          firstId: rows[0]?.id ?? null,
          lastId: rows.at(-1)?.id ?? null,
        },
      },
      200,
    )
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
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.projectId, auth.project.id), eq(agentDefinitions.status, 'active')))
      .orderBy(desc(agentDefinitions.createdAt), desc(agentDefinitions.id))
    const candidates = rows
      .filter((row) => row.id !== agentId && matchesHandoffTarget(targets, row))
      .map(serializeHandoffCandidate)
    return c.json(
      {
        data: candidates,
        pagination: {
          limit: candidates.length,
          nextCursor: null,
          hasMore: false,
          firstId: candidates[0]?.id ?? null,
          lastId: candidates.at(-1)?.id ?? null,
        },
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
  .openapi(updateAgentMemoryRoute, async (c) => {
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
    if (hasSecretMaterial(body.metadata)) {
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
        content: body.content ?? '',
        metadata: stringify(body.metadata ?? {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(agentMemories).values(created)
      return c.json(serializeAgentMemory(created), 200)
    }

    const updated = {
      content: body.content ?? existing.content,
      metadata: stringify(mergeMetadata(parseJson<Record<string, unknown>>(existing.metadata), body.metadata)),
      updatedAt: timestamp,
    }
    await db
      .update(agentMemories)
      .set(updated)
      .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, auth.project.id)))
    return c.json(serializeAgentMemory({ ...existing, ...updated }), 200)
  })

export default routes
