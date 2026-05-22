import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { z } from 'zod'
import { agentDefinitions, sessions } from '../db/schema'
import type { Env } from '../env'

const app = new Hono<{ Bindings: Env }>()

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().max(8000).optional(),
})

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

app.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(agentDefinitions).limit(100)
  return c.json({ data: rows })
})

app.post('/', async (c) => {
  const parsed = CreateAgentSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, 400)
  }

  const timestamp = now()
  const row = {
    id: newId('agent'),
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    model: parsed.data.model ?? c.env.AMA_DEFAULT_MODEL ?? '@cf/meta/llama-3.1-8b-instruct',
    systemPrompt: parsed.data.systemPrompt ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const db = drizzle(c.env.DB)
  await db.insert(agentDefinitions).values(row)

  return c.json(row, 201)
})

app.post('/:agentId/sessions', async (c) => {
  const agentId = c.req.param('agentId')
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
