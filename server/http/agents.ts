import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { normalizeToolAttachments } from '@server/domain/agent'
import { drizzle } from 'drizzle-orm/d1'
import { requestId } from '../audit'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import {
  createAgent,
  memoryEnabled,
  readAgentMemory,
  replaceAgentMemory,
  resolveHandoffCandidates,
  type UpdateAgentPatch,
  updateAgent,
} from '../usecases/agents'
import {
  AgentArchivedError,
  type AgentMemoryRecord,
  type AgentRecord,
  AgentValidationError,
  type AgentVersionRecord,
  type AuthScope,
} from '../usecases/ports'

type AgentRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())
const HandoffPolicySchema = JsonObjectSchema.openapi({
  example: { enabled: true, targets: [{ role: 'reviewer' }, { capability: 'code-review' }] },
})
const MemoryPolicySchema = JsonObjectSchema.openapi({
  example: { enabled: true, mode: 'notebook', scope: 'project_agent' },
})

const TOOL_APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

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

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

// The DTO that crosses the wire mirrors AgentRecord; serialization is identity
// plus the version field that the record already carries.
function serializeAgent(record: AgentRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    instructions: record.instructions,
    providerId: record.providerId,
    model: record.model,
    skills: record.skills,
    subagents: record.subagents,
    role: record.role,
    capabilityTags: record.capabilityTags,
    handoffPolicy: record.handoffPolicy,
    memoryPolicy: record.memoryPolicy,
    tools: record.tools,
    mcpConnectors: record.mcpConnectors,
    metadata: record.metadata,
    archivedAt: record.archivedAt,
    currentVersionId: record.currentVersionId,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeAgentVersion(record: AgentVersionRecord) {
  return {
    id: record.id,
    agentId: record.agentId,
    projectId: record.projectId,
    version: record.version,
    instructions: record.instructions,
    providerId: record.providerId,
    model: record.model,
    skills: record.skills,
    subagents: record.subagents,
    role: record.role,
    capabilityTags: record.capabilityTags,
    handoffPolicy: record.handoffPolicy,
    memoryPolicy: record.memoryPolicy,
    tools: record.tools,
    mcpConnectors: record.mcpConnectors,
    metadata: record.metadata,
    createdAt: record.createdAt,
  }
}

function serializeAgentMemory(record: AgentMemoryRecord) {
  return {
    agentId: record.agentId,
    projectId: record.projectId,
    content: record.content,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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
    200: { description: 'Agent list', content: { 'application/json': { schema: AgentListResponseSchema } } },
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
    200: { description: 'Agent versions', content: { 'application/json': { schema: AgentVersionListResponseSchema } } },
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

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the agents resource's original mount position.
export function registerAgentRoutes(routes: AgentRoutes) {
  // Returns the chained router so the accumulated OpenAPI route types flow into
  // AppType (the frontend's hc<AppType> client depends on them).
  return routes
    .openapi(listAgentsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.agents.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        {
          data: page.rows.map(serializeAgent),
          pagination: { limit, nextCursor, hasMore: page.hasMore },
        },
        200,
      )
    })
    .openapi(createAgentRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      try {
        const agent = await createAgent(deps, authScope(auth), {
          name: body.name,
          description: body.description ?? null,
          config: configFromPayload(body),
        })
        return c.json(serializeAgent(agent), 201)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readAgentRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      return c.json(serializeAgent(agent), 200)
    })
    .openapi(updateAgentRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      const scope = authScope(auth)
      const before = agent
      try {
        const result = await updateAgent(deps, scope, agent, patchFromBody(body))
        if (result.archived) {
          await deps.audit.record(scope, {
            action: 'agent.archive',
            resourceType: 'agent',
            resourceId: agentId,
            outcome: 'success',
            requestId: requestId(c),
            before: serializeAgent(before),
            after: { archivedAt: result.agent.archivedAt },
          })
        } else if (before.archivedAt && result.agent.archivedAt === null) {
          await deps.audit.record(scope, {
            action: 'agent.unarchive',
            resourceType: 'agent',
            resourceId: agentId,
            outcome: 'success',
            requestId: requestId(c),
            before: { archivedAt: before.archivedAt },
            after: { archivedAt: null },
          })
        }
        return c.json(serializeAgent(result.agent), 200)
      } catch (error) {
        if (error instanceof AgentArchivedError) {
          return c.json({ error: { type: 'conflict', message: error.message } }, 409)
        }
        return validationOr(c, error)
      }
    })
    .openapi(listAgentVersionsRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      const versions = await deps.agents.listVersions(auth.project.id, agentId)
      return c.json(
        {
          data: versions.map(serializeAgentVersion),
          pagination: { limit: versions.length, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(readAgentVersionRoute, async (c) => {
      const { agentId, version } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      const row = await deps.agents.findVersion(auth.project.id, agentId, version)
      if (!row) {
        return c.json({ error: { type: 'not_found', message: 'Agent version not found' } }, 404)
      }
      return c.json(serializeAgentVersion(row), 200)
    })
    .openapi(listAgentHandoffCandidatesRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const { role, capability } = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      try {
        const candidates = await resolveHandoffCandidates(deps, auth.project.id, agent, {
          ...(role !== undefined ? { role } : {}),
          ...(capability !== undefined ? { capability } : {}),
        })
        return c.json(
          { data: candidates, pagination: { limit: candidates.length, nextCursor: null, hasMore: false } },
          200,
        )
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readAgentMemoryRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      if (!memoryEnabled(agent.memoryPolicy)) {
        return c.json({ error: { type: 'conflict', message: 'Agent memory is disabled' } }, 409)
      }
      const memory = await readAgentMemory(deps, auth.project.id, agent)
      return c.json(serializeAgentMemory(memory), 200)
    })
    .openapi(replaceAgentMemoryRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      if (!memoryEnabled(agent.memoryPolicy)) {
        return c.json({ error: { type: 'conflict', message: 'Agent memory is disabled' } }, 409)
      }
      try {
        const memory = await replaceAgentMemory(deps, auth.project.id, agent, {
          content: body.content,
          metadata: body.metadata ?? {},
        })
        return c.json(serializeAgentMemory(memory), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
}

// --- helpers ---

function authScope(auth: Awaited<ReturnType<typeof requireAuth>> & object): AuthScope {
  return auth as unknown as AuthScope
}

// Builds the usecase patch from the validated PATCH body: only present fields
// are forwarded (so an absent field is distinct from an explicit null), and
// tool inputs are normalized to the attachment contract.
function patchFromBody(body: z.infer<typeof UpdateAgentSchema>): UpdateAgentPatch {
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
    ...(body.providerId !== undefined ? { providerId: body.providerId } : {}),
    ...(body.model !== undefined ? { model: body.model } : {}),
    ...(body.skills !== undefined ? { skills: body.skills } : {}),
    ...(body.subagents !== undefined ? { subagents: body.subagents } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.capabilityTags !== undefined ? { capabilityTags: body.capabilityTags } : {}),
    ...(body.handoffPolicy !== undefined ? { handoffPolicy: body.handoffPolicy } : {}),
    ...(body.memoryPolicy !== undefined ? { memoryPolicy: body.memoryPolicy } : {}),
    ...(body.tools !== undefined ? { tools: normalizeToolAttachments(body.tools) } : {}),
    ...(body.mcpConnectors !== undefined ? { mcpConnectors: body.mcpConnectors } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    ...(body.archived !== undefined ? { archived: body.archived } : {}),
  }
}

function configFromPayload(body: z.infer<typeof AgentPayloadSchema>) {
  return {
    instructions: body.instructions ?? null,
    providerId: body.providerId ?? null,
    model: body.model ?? null,
    skills: body.skills ?? [],
    subagents: body.subagents ?? [],
    role: body.role ?? null,
    capabilityTags: body.capabilityTags ?? [],
    handoffPolicy: body.handoffPolicy ?? {},
    memoryPolicy: body.memoryPolicy ?? { enabled: false },
    tools: normalizeToolAttachments(body.tools ?? []),
    mcpConnectors: body.mcpConnectors ?? [],
    metadata: body.metadata ?? {},
  }
}

function notFound(c: Parameters<Parameters<AgentRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
}

function validationOr(c: Parameters<Parameters<AgentRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof AgentValidationError) {
    return c.json(domainValidation(error.message, error.fields), 400)
  }
  throw error
}
