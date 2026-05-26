import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import {
  agentDefinitions,
  agentDefinitionVersions,
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

const app = createApiRouter()

const DEFAULT_PROVIDER = 'workers-ai'
const DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.6'
const BLOCKED_TOOLS = new Set(['secrets.read', 'filesystem.host', 'network.raw'])

const JsonObjectSchema = z.record(z.string(), z.unknown())
const SandboxPolicySchema = z
  .object({
    network: z.enum(['enabled', 'disabled']).optional(),
    filesystem: z.enum(['workspace', 'read-only']).optional(),
  })
  .strict()

const AgentSchema = z
  .object({
    id: z.string().openapi({ example: 'agent_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Research assistant' }),
    description: z.string().nullable().openapi({ example: 'Answers with citations.' }),
    instructions: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    provider: z.string().openapi({ example: DEFAULT_PROVIDER }),
    model: z.string().openapi({ example: DEFAULT_MODEL }),
    systemPrompt: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    allowedTools: z.array(z.string()).openapi({ example: ['web.search'] }),
    mcpConnectors: z.array(z.string()).openapi({ example: ['github'] }),
    sandboxPolicy: JsonObjectSchema.openapi({ example: { network: 'enabled', filesystem: 'workspace' } }),
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
    model: z.string().openapi({ example: DEFAULT_MODEL }),
    systemPrompt: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    allowedTools: z.array(z.string()).openapi({ example: ['web.search'] }),
    mcpConnectors: z.array(z.string()).openapi({ example: ['github'] }),
    sandboxPolicy: JsonObjectSchema.openapi({ example: { network: 'enabled' } }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('AgentVersion')

const AgentPayloadSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Research assistant' }),
    description: z.string().max(1000).optional().openapi({ example: 'Answers with citations.' }),
    instructions: z.string().max(8000).optional().openapi({ example: 'Answer with citations.' }),
    provider: z.string().min(1).optional().openapi({ example: DEFAULT_PROVIDER }),
    model: z.string().min(1).optional().openapi({ example: DEFAULT_MODEL }),
    systemPrompt: z.string().max(8000).optional().openapi({ example: 'Answer with citations.' }),
    allowedTools: z
      .array(z.string().min(1))
      .max(100)
      .optional()
      .openapi({ example: ['web.search'] }),
    mcpConnectors: z
      .array(z.string().min(1).max(120))
      .max(50)
      .optional()
      .openapi({ example: ['github'] }),
    sandboxPolicy: SandboxPolicySchema.optional().openapi({ example: { network: 'enabled' } }),
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

type AgentRow = typeof agentDefinitions.$inferSelect
type AgentVersionRow = typeof agentDefinitionVersions.$inferSelect

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
  if (!configured || configured.status !== 'active') {
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
  return blocked ? { allowedTools: `Tool is blocked by policy: ${blocked}` } : null
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

function hasSecretMaterial(value: unknown): boolean {
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
    allowedTools: parseJson<string[]>(row.allowedTools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy),
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
    allowedTools: parseJson<string[]>(row.allowedTools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
  }
}

async function createAgentVersion(
  db: ReturnType<typeof drizzle>,
  agent: Pick<AgentRow, 'id' | 'projectId'>,
  values: {
    instructions: string | null
    provider: string
    model: string
    systemPrompt: string | null
    allowedTools: string[]
    mcpConnectors: string[]
    sandboxPolicy: Record<string, unknown>
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
    allowedTools: stringify(values.allowedTools),
    mcpConnectors: stringify(values.mcpConnectors),
    sandboxPolicy: stringify(values.sandboxPolicy),
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
    const model = body.model ?? c.env.AMA_DEFAULT_MODEL ?? DEFAULT_MODEL
    const allowedTools = body.allowedTools ?? []
    const mcpConnectors = body.mcpConnectors ?? []
    const sandboxPolicy = body.sandboxPolicy ?? {}
    const metadata = body.metadata ?? {}
    const validation =
      (await validateConfiguredProviderModel(db, auth.project.id, provider, model, c.env.AMA_DEFAULT_MODEL)) ??
      validateAllowedTools(allowedTools) ??
      (await validateMcpConnectors(db, auth.project.id, mcpConnectors)) ??
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
      allowedTools: stringify(allowedTools),
      mcpConnectors: stringify(mcpConnectors),
      sandboxPolicy: stringify(sandboxPolicy),
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
      allowedTools,
      mcpConnectors,
      sandboxPolicy,
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
      description: body.description ?? agent.description,
      instructions: body.instructions ?? agent.instructions,
      provider: await normalizeRequestedProvider(db, auth.project.id, body.provider ?? agent.provider),
      model: body.model ?? agent.model,
      systemPrompt: body.systemPrompt ?? agent.systemPrompt,
      allowedTools: body.allowedTools ?? parseJson<string[]>(agent.allowedTools),
      mcpConnectors: body.mcpConnectors ?? parseJson<string[]>(agent.mcpConnectors),
      sandboxPolicy: body.sandboxPolicy ?? parseJson<Record<string, unknown>>(agent.sandboxPolicy),
      metadata: mergeMetadata(parseJson<Record<string, unknown>>(agent.metadata), body.metadata),
    }
    const validation =
      (await validateConfiguredProviderModel(
        db,
        auth.project.id,
        next.provider,
        next.model,
        c.env.AMA_DEFAULT_MODEL,
      )) ??
      validateAllowedTools(next.allowedTools) ??
      (await validateMcpConnectors(db, auth.project.id, next.mcpConnectors)) ??
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
      body.allowedTools !== undefined ||
      body.mcpConnectors !== undefined ||
      body.sandboxPolicy !== undefined ||
      body.metadata !== undefined
    const version = runtimeChanged
      ? await createAgentVersion(db, agent, { ...next, createdAt: timestamp })
      : await currentAgentVersion(db, agent)
    const updated = {
      ...next,
      allowedTools: stringify(next.allowedTools),
      mcpConnectors: stringify(next.mcpConnectors),
      sandboxPolicy: stringify(next.sandboxPolicy),
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

export default routes
