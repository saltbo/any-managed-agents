import { swaggerUI } from '@hono/swagger-ui'
import { and, eq, max } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { cors } from 'hono/cors'
import { recordAudit, requestId } from './audit'
import { type AuthContext, requireAuth } from './auth/session'
import { sessionEvents, sessions } from './db/schema'
import { errorResponse } from './errors'
import { ApiSecuritySchemes, createApiRouter } from './openapi'
import { evaluateMcpToolPolicy } from './policy'
import agents from './routes/agents'
import audit from './routes/audit'
import auth from './routes/auth'
import environments from './routes/environments'
import governance from './routes/governance'
import health from './routes/health'
import mcp from './routes/mcp'
import providers from './routes/providers'
import sessionRoutes from './routes/sessions'
import usage from './routes/usage'
import vaults from './routes/vaults'
import { proxyPiRuntime } from './runtime/pi/bridge'

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

async function appendRuntimePolicyEvent(
  db: ReturnType<typeof drizzle>,
  values: {
    auth: AuthContext
    sessionId: string
    payload: Record<string, unknown>
  },
) {
  const latest = await db
    .select({ sequence: max(sessionEvents.sequence) })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, values.sessionId))
    .get()
  await db.insert(sessionEvents).values({
    id: newId('event'),
    organizationId: values.auth.organization.id,
    projectId: values.auth.project.id,
    sessionId: values.sessionId,
    sequence: (latest?.sequence ?? 0) + 1,
    type: 'policy',
    visibility: 'audit',
    role: null,
    parentEventId: null,
    correlationId: null,
    payload: JSON.stringify(values.payload),
    metadata: '{}',
    createdAt: new Date().toISOString(),
  })
}

export function createApp() {
  const app = createApiRouter()

  app.use(
    '/*',
    cors({
      origin: (origin, c) => {
        const allowedOrigins = c.env.AMA_ALLOWED_ORIGINS
        if (!allowedOrigins) {
          return null
        }
        return allowedOrigins.split(',').includes(origin) ? origin : null
      },
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }),
  )

  app.route('/api/health', health)
  app.route('/api/auth', auth)
  app.route('/api/agents', agents)
  app.route('/api/environments', environments)
  app.route('/api/providers', providers)
  app.route('/api/governance', governance)
  app.route('/api/mcp', mcp)
  app.route('/api/usage', usage)
  app.route('/api/audit-records', audit)
  app.route('/api/sessions', sessionRoutes)
  app.route('/api/vaults', vaults)

  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', ApiSecuritySchemes.cookieAuth)

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Any Managed Agents API',
      version: '0.1.0',
      description: 'Control-plane API for Any Managed Agents.',
    },
    servers: [{ url: '/api' }],
  })

  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }))

  app.all('/runtime/sessions/:sessionId/*', async (c) => {
    const db = drizzle(c.env.DB)
    const resolvedAuth = await requireAuth(c, db)
    if (resolvedAuth instanceof Response) {
      return resolvedAuth
    }

    const sessionId = c.req.param('sessionId')
    const session = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, resolvedAuth.project.id)))
      .get()
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Session not found')
    }
    if (session.status !== 'idle' && session.status !== 'running') {
      return errorResponse(c, 409, 'conflict', 'Session runtime is not active')
    }
    if (!session.sandboxId) {
      return errorResponse(c, 409, 'conflict', 'Session runtime is unavailable')
    }

    const path = c.req.path.replace(`/runtime/sessions/${sessionId}`, '')
    const mcpMatch = path.match(/^\/mcp\/([^/]+)\/tools\/([^/]+)\/calls$/)
    if (mcpMatch && c.req.method === 'POST') {
      const connectorId = decodeURIComponent(mcpMatch[1] ?? '')
      const toolName = decodeURIComponent(mcpMatch[2] ?? '')
      const decision = await evaluateMcpToolPolicy(db, resolvedAuth, {
        connectorId,
        toolName,
        session: {
          id: session.id,
          agentSnapshot: session.agentSnapshot,
          environmentSnapshot: session.environmentSnapshot,
        },
      })
      if (!decision.allowed) {
        const payload = { connectorId, toolName, decision }
        await appendRuntimePolicyEvent(db, { auth: resolvedAuth, sessionId, payload })
        await recordAudit(db, {
          auth: resolvedAuth,
          action: 'runtime_mcp_tool.call',
          resourceType: decision.category === 'tool' ? 'tool' : 'mcp_connector',
          resourceId: decision.category === 'tool' ? toolName : connectorId,
          outcome: 'denied',
          requestId: requestId(c),
          sessionId,
          policyCategory: decision.category,
          metadata: payload,
        })
        return errorResponse(
          c,
          decision.category === 'approval' ? 409 : 403,
          decision.category === 'approval' ? 'conflict' : 'policy_denied',
          decision.message,
          {
            category: decision.category,
            resourceType: decision.category === 'tool' ? 'tool' : 'mcp_connector',
            resourceId: decision.category === 'tool' ? toolName : connectorId,
            ruleId: decision.rule,
          },
        )
      }
    }

    return await proxyPiRuntime(c.env, session.sandboxId, c.req.raw)
  })

  app.all('/agents/*', async (c) => {
    const db = drizzle(c.env.DB)
    const resolvedAuth = await requireAuth(c, db)
    if (resolvedAuth instanceof Response) {
      return resolvedAuth
    }

    const durableObjectName = c.req.path.split('/').slice(3, 4)[0]
    if (!durableObjectName) {
      return errorResponse(c, 404, 'not_found', 'Agent session not found')
    }

    const session = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.durableObjectName, durableObjectName), eq(sessions.projectId, resolvedAuth.project.id)))
      .get()
    if (!session) {
      return errorResponse(c, 404, 'not_found', 'Agent session not found')
    }

    const { routeAgentRequest } = await import('agents')
    const response = await routeAgentRequest(c.req.raw, c.env)
    return response ?? c.text('Agent not found', 404)
  })

  app.notFound((c) => c.json({ error: { type: 'not_found', message: 'Not found' } }, 404))

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: { type: 'internal_error', message: 'Internal server error' } }, 500)
  })

  return app
}
