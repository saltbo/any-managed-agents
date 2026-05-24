import { swaggerUI } from '@hono/swagger-ui'
import { and, eq, max } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { cors } from 'hono/cors'
import { recordAudit, requestId } from './audit'
import { type AuthContext, requireAuth } from './auth/session'
import { sessionEvents, sessions } from './db/schema'
import type { Env } from './env'
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

type RuntimeEventType = 'message' | 'tool' | 'sandbox' | 'policy' | 'usage' | 'error' | 'lifecycle'
type RuntimeEventVisibility = 'transcript' | 'debug' | 'audit'

const REDACTED_VALUE = '[REDACTED]'
const SENSITIVE_KEY = /api[_-]?key|authorization|credential|password|secret|token/i

function redactRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactRuntimeValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED_VALUE : redactRuntimeValue(item),
      ]),
    )
  }
  if (typeof value === 'string' && /(bearer\s+|raw-[\w-]*token|secret|token=|api[_-]?key)/i.test(value)) {
    return REDACTED_VALUE
  }
  return value
}

async function appendRuntimeEvent(
  db: ReturnType<typeof drizzle>,
  values: {
    auth: AuthContext
    sessionId: string
    type: RuntimeEventType
    visibility: RuntimeEventVisibility
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
    role?: string | null
    parentEventId?: string | null
    correlationId?: string | null
  },
) {
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
        type: values.type,
        visibility: values.visibility,
        role: values.role ?? null,
        parentEventId: values.parentEventId ?? null,
        correlationId: values.correlationId ?? null,
        payload: JSON.stringify(redactRuntimeValue(values.payload)),
        metadata: JSON.stringify(redactRuntimeValue(values.metadata ?? {})),
        createdAt: new Date().toISOString(),
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

async function appendRuntimePolicyEvent(
  db: ReturnType<typeof drizzle>,
  values: {
    auth: AuthContext
    sessionId: string
    payload: Record<string, unknown>
  },
) {
  await appendRuntimeEvent(db, {
    auth: values.auth,
    sessionId: values.sessionId,
    type: 'policy',
    visibility: 'audit',
    payload: values.payload,
  })
}

function runtimeTaskMessage(body: unknown) {
  if (!body || typeof body !== 'object') {
    return ''
  }
  const record = body as Record<string, unknown>
  const value = record.message ?? record.input ?? record.prompt ?? record.task
  return typeof value === 'string' ? value : ''
}

function runtimeToolCalls(body: unknown) {
  if (!body || typeof body !== 'object') {
    return []
  }
  const calls = (body as Record<string, unknown>).toolCalls
  return Array.isArray(calls)
    ? calls.filter((call): call is Record<string, unknown> => !!call && typeof call === 'object')
    : []
}

async function recordRuntimeTaskSubmission(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  body: unknown,
) {
  const timestamp = new Date().toISOString()
  const correlationId = newId('task')
  const message = runtimeTaskMessage(body)
  await db
    .update(sessions)
    .set({ status: 'running', statusReason: null, updatedAt: timestamp })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    type: 'lifecycle',
    visibility: 'audit',
    correlationId,
    payload: { status: 'running', reason: 'task_started' },
  })
  if (message) {
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'message',
      visibility: 'transcript',
      role: 'user',
      correlationId,
      payload: { content: message },
    })
  }
  return correlationId
}

async function recordTestRuntimeTaskOutcome(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  body: unknown,
  correlationId: string,
) {
  for (const [index, call] of runtimeToolCalls(body).entries()) {
    const toolCallId = typeof call.id === 'string' ? call.id : `tool_${index + 1}`
    const toolName = typeof call.name === 'string' ? call.name : 'tool'
    const durationMs = typeof call.durationMs === 'number' ? call.durationMs : 0
    const approvalState = typeof call.approvalState === 'string' ? call.approvalState : 'approved'
    const startedAt = new Date(Date.now() - durationMs).toISOString()
    const callEventId = await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'tool',
      visibility: 'debug',
      correlationId: toolCallId,
      payload: {
        phase: 'call',
        toolCallId,
        toolName,
        approvalState,
        input: call.input ?? {},
        startedAt,
      },
    })
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'tool',
      visibility: 'debug',
      parentEventId: callEventId,
      correlationId: toolCallId,
      payload: {
        phase: 'result',
        toolCallId,
        toolName,
        approvalState,
        output: call.output ?? {},
        error: call.error ?? null,
        status: call.error ? 'error' : 'success',
        durationMs,
      },
    })
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (record.simulateError) {
    const rawMessage = typeof record.errorMessage === 'string' ? record.errorMessage : 'Runtime task failed'
    const safeMessage = redactRuntimeValue(rawMessage) as string
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'error',
      visibility: 'debug',
      correlationId,
      payload: { type: 'runtime_error', message: safeMessage },
    })
    await db
      .update(sessions)
      .set({ status: 'error', statusReason: safeMessage, updatedAt: new Date().toISOString() })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    return
  }

  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    type: 'message',
    visibility: 'transcript',
    role: 'assistant',
    correlationId,
    payload: { content: typeof record.response === 'string' ? record.response : 'Task accepted by Pi runtime.' },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    type: 'usage',
    visibility: 'debug',
    correlationId,
    payload: {
      provider: session.modelProvider,
      model: session.modelConfig ? (JSON.parse(session.modelConfig) as Record<string, unknown>).model : null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    type: 'lifecycle',
    visibility: 'audit',
    correlationId,
    payload: { status: 'idle', reason: 'task_completed' },
  })
  await db
    .update(sessions)
    .set({ status: 'idle', updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
}

async function recordRuntimeProxyFailure(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  response: Response,
) {
  if (response.ok) {
    return
  }
  const safeMessage = `Pi runtime returned ${response.status}`
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    type: 'error',
    visibility: 'debug',
    payload: { type: 'runtime_error', message: safeMessage, status: response.status },
  })
  await db
    .update(sessions)
    .set({ status: 'error', statusReason: safeMessage, updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
}

async function ingestPiRuntimeLine(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  line: string,
) {
  if (!line.trim()) {
    return false
  }
  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(line) as unknown
    parsed = value && typeof value === 'object' ? (value as Record<string, unknown>) : { content: line }
  } catch {
    parsed = { content: line }
  }
  const type = typeof parsed.type === 'string' ? parsed.type : 'message'
  if (type === 'agent_end') {
    const finalContent = parsed.content ?? parsed.message ?? parsed.data
    if (finalContent) {
      await appendRuntimeEvent(db, {
        auth,
        sessionId: session.id,
        type: 'message',
        visibility: 'transcript',
        role: 'assistant',
        payload: { content: finalContent },
      })
    }
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'lifecycle',
      visibility: 'audit',
      payload: { status: 'idle', reason: 'task_completed' },
    })
    await db
      .update(sessions)
      .set({ status: 'idle', statusReason: null, updatedAt: new Date().toISOString() })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    return true
  }
  if (type === 'bridge_exit') {
    const failed = parsed.code !== 0 && parsed.code !== null
    const status = failed ? 'error' : 'idle'
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'lifecycle',
      visibility: 'audit',
      payload: { status, reason: 'runtime_exit', code: parsed.code ?? null, signal: parsed.signal ?? null },
    })
    await db
      .update(sessions)
      .set({
        status,
        statusReason: failed ? 'Pi runtime exited with an error' : null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    return true
  }
  if (type === 'bridge_stderr' || type === 'error') {
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'error',
      visibility: 'debug',
      payload: { type: 'runtime_error', message: parsed.data ?? parsed.message ?? 'Runtime error' },
    })
    return false
  }
  if (type === 'tool_call' || type === 'tool_result') {
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'tool',
      visibility: 'debug',
      parentEventId: typeof parsed.parentEventId === 'string' ? parsed.parentEventId : null,
      correlationId: typeof parsed.toolCallId === 'string' ? parsed.toolCallId : null,
      payload: parsed,
    })
    return false
  }
  if (type === 'usage') {
    await appendRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      type: 'usage',
      visibility: 'debug',
      payload: parsed,
    })
    return false
  }
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    type: 'message',
    visibility: 'transcript',
    role: typeof parsed.role === 'string' ? parsed.role : 'assistant',
    payload: { content: parsed.content ?? parsed.message ?? parsed.data ?? line },
  })
  return false
}

async function drainPiRuntimeEvents(
  env: Env,
  sandboxId: string,
  request: Request,
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
) {
  const streamRequest = new Request(request.url, { method: 'GET', headers: request.headers })
  const response = await proxyPiRuntime(env, sandboxId, streamRequest)
  if (!response.body) {
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      pending += decoder.decode(result.value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const terminal = await ingestPiRuntimeLine(db, auth, session, line)
        if (terminal) {
          await reader.cancel().catch(() => undefined)
          return
        }
      }
    }
    const final = `${pending}${decoder.decode()}`
    if (final.trim()) {
      await ingestPiRuntimeLine(db, auth, session, final)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
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
      description:
        'Control-plane API for Any Managed Agents. Command-line automation uses restish or direct HTTP against this OpenAPI document; runtime traffic remains Pi-compatible through AMA runtime proxy endpoints.',
    },
    servers: [{ url: '/' }],
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

    const request = c.req.raw
    let runtimeRequestBody: unknown = {}
    if (c.env.AMA_RUNTIME_MODE === 'test' && path === '/rpc' && request.method === 'POST') {
      runtimeRequestBody = await request
        .clone()
        .json()
        .catch(() => ({}))
    }
    if (path === '/rpc' && request.method === 'POST') {
      const body =
        c.env.AMA_RUNTIME_MODE === 'test'
          ? runtimeRequestBody
          : await request
              .clone()
              .json()
              .catch(() => ({}))
      const correlationId = await recordRuntimeTaskSubmission(db, resolvedAuth, session, body)
      if (c.env.AMA_RUNTIME_MODE === 'test') {
        await recordTestRuntimeTaskOutcome(db, resolvedAuth, session, body, correlationId)
      }
    }

    const response = await proxyPiRuntime(c.env, session.sandboxId, request)
    if (path === '/rpc' && request.method === 'POST') {
      await recordRuntimeProxyFailure(db, resolvedAuth, session, response.clone())
      if (response.ok && c.env.AMA_RUNTIME_MODE !== 'test') {
        c.executionCtx.waitUntil(drainPiRuntimeEvents(c.env, session.sandboxId, request, db, resolvedAuth, session))
      }
    }
    return response
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
