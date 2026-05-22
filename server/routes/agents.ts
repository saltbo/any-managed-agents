import { createRoute, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { agentDefinitions, sessions } from '../db/schema'
import { createApiRouter, ErrorResponseSchema } from '../openapi'

const app = createApiRouter()

const AgentSchema = z
  .object({
    id: z.string().openapi({ example: 'agent_abc123' }),
    name: z.string().openapi({ example: 'Research assistant' }),
    description: z.string().nullable().openapi({ example: 'Answers with citations.' }),
    model: z.string().openapi({ example: '@cf/meta/llama-3.1-8b-instruct' }),
    systemPrompt: z.string().nullable().openapi({ example: 'Answer with citations.' }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('Agent')

const CreateAgentSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Research assistant' }),
    description: z.string().max(1000).optional().openapi({ example: 'Answers with citations.' }),
    model: z.string().min(1).optional().openapi({ example: '@cf/meta/llama-3.1-8b-instruct' }),
    systemPrompt: z.string().max(8000).optional().openapi({ example: 'Answer with citations.' }),
  })
  .openapi('CreateAgentRequest')

const SessionSchema = z
  .object({
    id: z.string().openapi({ example: 'session_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    durableObjectName: z.string().openapi({ example: 'session_abc123' }),
    status: z.string().openapi({ example: 'idle' }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    agentUrl: z.string().openapi({ example: '/agents/managed-agent/session_abc123' }),
  })
  .openapi('Session')

const AgentParamsSchema = z.object({
  agentId: z.string().openapi({
    param: {
      name: 'agentId',
      in: 'path',
    },
    example: 'agent_abc123',
  }),
})

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

const listAgentsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Agents'],
  summary: 'List agents',
  responses: {
    200: {
      description: 'Agent list',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(AgentSchema) }),
        },
      },
    },
  },
})

const createAgentRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Agents'],
  summary: 'Create an agent',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: CreateAgentSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created agent',
      content: {
        'application/json': {
          schema: AgentSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

const createSessionRoute = createRoute({
  method: 'post',
  path: '/{agentId}/sessions',
  tags: ['Sessions'],
  summary: 'Create a session for an agent',
  request: {
    params: AgentParamsSchema,
  },
  responses: {
    201: {
      description: 'Created session',
      content: {
        'application/json': {
          schema: SessionSchema,
        },
      },
    },
    404: {
      description: 'Agent not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

app.openapi(listAgentsRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(agentDefinitions).limit(100)
  return c.json({ data: rows })
})

app.openapi(createAgentRoute, async (c) => {
  const body = c.req.valid('json')
  const timestamp = now()
  const row = {
    id: newId('agent'),
    name: body.name,
    description: body.description ?? null,
    model: body.model ?? c.env.AMA_DEFAULT_MODEL ?? '@cf/meta/llama-3.1-8b-instruct',
    systemPrompt: body.systemPrompt ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const db = drizzle(c.env.DB)
  await db.insert(agentDefinitions).values(row)

  return c.json(row, 201)
})

app.openapi(createSessionRoute, async (c) => {
  const { agentId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const agent = await db
    .select({ id: agentDefinitions.id })
    .from(agentDefinitions)
    .where(eq(agentDefinitions.id, agentId))
    .get()

  if (!agent) {
    return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
  }

  const timestamp = now()
  const id = newId('session')
  const row = {
    id,
    agentId,
    durableObjectName: id,
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await db.insert(sessions).values(row)

  return c.json(
    {
      ...row,
      agentUrl: `/agents/managed-agent/${id}`,
    },
    201,
  )
})

export default app
