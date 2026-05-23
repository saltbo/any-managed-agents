import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { agentDefinitions, agentDefinitionVersions, environments } from '../db/schema'
import { createApiRouter, ErrorResponseSchema } from '../openapi'
import { createSessionForAgent } from './sessions'

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
    sandboxPolicy: JsonObjectSchema.openapi({ example: { network: 'enabled', filesystem: 'workspace' } }),
    defaultEnvironmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    status: z.enum(['active', 'archived']).openapi({ example: 'active' }),
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
    sandboxPolicy: JsonObjectSchema.openapi({ example: { network: 'enabled' } }),
    defaultEnvironmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('AgentVersion')

const AgentPayloadSchema = z.object({
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
  sandboxPolicy: SandboxPolicySchema.optional().openapi({ example: { network: 'enabled' } }),
  defaultEnvironmentId: z.string().min(1).nullable().optional().openapi({ example: 'env_abc123' }),
  metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
})

const CreateAgentSchema = AgentPayloadSchema.openapi('CreateAgentRequest')
const UpdateAgentSchema = AgentPayloadSchema.partial().openapi('UpdateAgentRequest')

const SessionSchema = z
  .object({
    id: z.string().openapi({ example: 'session_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    agentVersionId: z.string().openapi({ example: 'agentver_abc123' }),
    agentSnapshot: AgentVersionSchema,
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    environmentVersionId: z.string().nullable().openapi({ example: 'envver_abc123' }),
    environmentSnapshot: z.record(z.string(), z.unknown()).nullable(),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    durableObjectName: z.string().openapi({ example: 'session_abc123' }),
    status: z.string().openapi({ example: 'idle' }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    agentUrl: z.string().openapi({ example: '/agents/managed-agent/session_abc123' }),
  })
  .openapi('Session')

const AgentParamsSchema = z.object({
  agentId: z.string().openapi({
    param: { name: 'agentId', in: 'path' },
    example: 'agent_abc123',
  }),
})

const ListQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .openapi({ param: { name: 'includeArchived', in: 'query' }, example: 'false' }),
})

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

function validateAllowedTools(allowedTools: string[]) {
  const blocked = allowedTools.find((tool) => BLOCKED_TOOLS.has(tool))
  return blocked ? { allowedTools: `Tool is blocked by policy: ${blocked}` } : null
}

async function validateDefaultEnvironment(
  db: ReturnType<typeof drizzle>,
  projectId: string,
  defaultEnvironmentId: string | null,
) {
  if (!defaultEnvironmentId) {
    return null
  }

  const environment = await db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.id, defaultEnvironmentId),
        eq(environments.projectId, projectId),
        eq(environments.status, 'active'),
      ),
    )
    .get()
  return environment ? null : { defaultEnvironmentId: 'Default environment is not available for this project.' }
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
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy),
    defaultEnvironmentId: row.defaultEnvironmentId,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    status: row.status as 'active' | 'archived',
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
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy),
    defaultEnvironmentId: row.defaultEnvironmentId,
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
    sandboxPolicy: Record<string, unknown>
    defaultEnvironmentId: string | null
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
    sandboxPolicy: stringify(values.sandboxPolicy),
    defaultEnvironmentId: values.defaultEnvironmentId,
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
  tags: ['Agents'],
  summary: 'List agents',
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Agent list',
      content: { 'application/json': { schema: z.object({ data: z.array(AgentSchema) }) } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createAgentRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Agents'],
  summary: 'Create an agent',
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
  tags: ['Agents'],
  summary: 'Read an agent',
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
  tags: ['Agents'],
  summary: 'Update an agent',
  request: {
    params: AgentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateAgentSchema } } },
  },
  responses: {
    200: { description: 'Updated agent', content: { 'application/json': { schema: AgentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveAgentRoute = createRoute({
  method: 'delete',
  path: '/{agentId}',
  tags: ['Agents'],
  summary: 'Archive an agent',
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
  tags: ['Agents'],
  summary: 'List agent versions',
  request: { params: AgentParamsSchema },
  responses: {
    200: {
      description: 'Agent versions',
      content: { 'application/json': { schema: z.object({ data: z.array(AgentVersionSchema) }) } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionRoute = createRoute({
  method: 'post',
  path: '/{agentId}/sessions',
  tags: ['Sessions'],
  summary: 'Create a session for an agent',
  request: { params: AgentParamsSchema },
  responses: {
    201: { description: 'Created session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'Archived agent or environment',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

app.openapi(listAgentsRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const { includeArchived } = c.req.valid('query')
  const where =
    includeArchived === 'true'
      ? eq(agentDefinitions.projectId, auth.project.id)
      : and(eq(agentDefinitions.projectId, auth.project.id), eq(agentDefinitions.status, 'active'))
  const rows = await db.select().from(agentDefinitions).where(where).limit(100)
  const data = await Promise.all(rows.map(async (row) => serializeAgent(row, await currentAgentVersion(db, row))))
  return c.json({ data }, 200)
})

app.openapi(createAgentRoute, async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const provider = body.provider ?? DEFAULT_PROVIDER
  const model = body.model ?? c.env.AMA_DEFAULT_MODEL ?? DEFAULT_MODEL
  const allowedTools = body.allowedTools ?? []
  const sandboxPolicy = body.sandboxPolicy ?? {}
  const metadata = body.metadata ?? {}
  const validation =
    validateProviderModel(provider, model, c.env.AMA_DEFAULT_MODEL) ??
    validateAllowedTools(allowedTools) ??
    (await validateDefaultEnvironment(db, auth.project.id, body.defaultEnvironmentId ?? null))
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
    sandboxPolicy: stringify(sandboxPolicy),
    defaultEnvironmentId: body.defaultEnvironmentId ?? null,
    metadata: stringify(metadata),
    status: 'active',
    currentVersionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.insert(agentDefinitions).values(row)
  const version = await createAgentVersion(db, row, {
    ...row,
    allowedTools,
    sandboxPolicy,
    metadata,
    createdAt: timestamp,
  })
  await db.update(agentDefinitions).set({ currentVersionId: version.id }).where(eq(agentDefinitions.id, row.id))

  return c.json(serializeAgent({ ...row, currentVersionId: version.id }, version), 201)
})

app.openapi(readAgentRoute, async (c) => {
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

app.openapi(updateAgentRoute, async (c) => {
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

  const next = {
    name: body.name ?? agent.name,
    description: body.description ?? agent.description,
    instructions: body.instructions ?? agent.instructions,
    provider: body.provider ?? agent.provider,
    model: body.model ?? agent.model,
    systemPrompt: body.systemPrompt ?? agent.systemPrompt,
    allowedTools: body.allowedTools ?? parseJson<string[]>(agent.allowedTools),
    sandboxPolicy: body.sandboxPolicy ?? parseJson<Record<string, unknown>>(agent.sandboxPolicy),
    defaultEnvironmentId:
      body.defaultEnvironmentId === undefined ? agent.defaultEnvironmentId : body.defaultEnvironmentId,
    metadata: body.metadata ?? parseJson<Record<string, unknown>>(agent.metadata),
  }
  const validation =
    validateProviderModel(next.provider, next.model, c.env.AMA_DEFAULT_MODEL) ??
    validateAllowedTools(next.allowedTools) ??
    (await validateDefaultEnvironment(db, auth.project.id, next.defaultEnvironmentId))
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
    body.sandboxPolicy !== undefined ||
    body.defaultEnvironmentId !== undefined
  const version = runtimeChanged
    ? await createAgentVersion(db, agent, { ...next, createdAt: timestamp })
    : await currentAgentVersion(db, agent)
  const updated = {
    ...next,
    allowedTools: stringify(next.allowedTools),
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

app.openapi(archiveAgentRoute, async (c) => {
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

  await db
    .update(agentDefinitions)
    .set({ status: 'archived', updatedAt: now() })
    .where(and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.projectId, auth.project.id)))
  return c.body(null, 204)
})

app.openapi(listAgentVersionsRoute, async (c) => {
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
  return c.json({ data: rows.map(serializeAgentVersion) }, 200)
})

app.openapi(createSessionRoute, async (c) => {
  const { agentId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  return await createSessionForAgent(c, db, auth, agentId)
})

export default app
