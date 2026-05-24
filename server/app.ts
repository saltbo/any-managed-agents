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

const REDACTED_VALUE = '[REDACTED]'
const SENSITIVE_KEY =
  /api[_-]?key|authorization|credential|password|secret|(^|[_-])token($|[_-])|access[_-]?token|refresh[_-]?token/i

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

function piEventType(event: Record<string, unknown>) {
  return typeof event.type === 'string' && event.type ? event.type : 'message'
}

async function appendPiRuntimeEvent(
  db: ReturnType<typeof drizzle>,
  values: {
    auth: AuthContext
    sessionId: string
    event: Record<string, unknown>
    metadata?: Record<string, unknown>
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
        type: piEventType(values.event),
        visibility: 'runtime',
        role: null,
        parentEventId: null,
        correlationId: null,
        payload: JSON.stringify(redactRuntimeValue(values.event)),
        metadata: JSON.stringify(redactRuntimeValue(values.metadata ?? { source: 'pi' })),
        createdAt: new Date().toISOString(),
      })
      return eventId
    } catch (error) {
      if (attempt === 4 || !String(error).includes('UNIQUE')) {
        throw error
      }
    }
  }
  throw new Error('Unable to append Pi runtime event')
}

async function appendRuntimePolicyEvent(
  db: ReturnType<typeof drizzle>,
  values: {
    auth: AuthContext
    sessionId: string
    payload: Record<string, unknown>
  },
) {
  await recordAudit(db, {
    auth: values.auth,
    action: 'runtime.policy',
    resourceType: 'session',
    resourceId: values.sessionId,
    outcome: 'denied',
    metadata: values.payload,
  })
}

type RuntimeCommand = {
  id?: string
  type: 'get_state' | 'prompt' | 'steer' | 'follow_up' | 'abort'
  message?: string
}

function runtimeCommand(body: unknown): RuntimeCommand | null {
  if (!body || typeof body !== 'object') {
    return null
  }
  const record = body as Record<string, unknown>
  const type = record.type
  if (type !== 'get_state' && type !== 'prompt' && type !== 'steer' && type !== 'follow_up' && type !== 'abort') {
    return null
  }
  const message = typeof record.message === 'string' ? record.message : undefined
  return {
    type,
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(message ? { message } : {}),
  }
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

async function recordRuntimeMessageSubmission(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  _body: unknown,
) {
  const timestamp = new Date().toISOString()
  const correlationId = newId('message')
  await db
    .update(sessions)
    .set({ status: 'running', statusReason: null, updatedAt: timestamp })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  return correlationId
}

async function recordTestRuntimeMessageOutcome(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  body: unknown,
  _correlationId: string,
) {
  for (const [index, call] of runtimeToolCalls(body).entries()) {
    const toolCallId = typeof call.id === 'string' ? call.id : `tool_${index + 1}`
    const toolName = typeof call.name === 'string' ? call.name : 'tool'
    const durationMs = typeof call.durationMs === 'number' ? call.durationMs : 0
    await appendPiRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      event: {
        type: 'tool_execution_start',
        id: toolCallId,
        toolCall: {
          id: toolCallId,
          name: toolName,
          input: call.input ?? {},
        },
      },
    })
    await appendPiRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      event: {
        type: 'tool_execution_end',
        id: toolCallId,
        toolCall: {
          id: toolCallId,
          name: toolName,
          output: call.output ?? {},
          error: call.error ?? null,
          durationMs,
        },
      },
    })
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (record.simulateError) {
    const rawMessage = typeof record.errorMessage === 'string' ? record.errorMessage : 'Runtime message failed'
    const safeMessage = redactRuntimeValue(rawMessage) as string
    await appendPiRuntimeEvent(db, {
      auth,
      sessionId: session.id,
      event: { type: 'error', message: safeMessage },
    })
    await db
      .update(sessions)
      .set({ status: 'error', statusReason: safeMessage, updatedAt: new Date().toISOString() })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    return
  }

  await appendPiRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: typeof record.response === 'string' ? record.response : 'Message accepted by Pi runtime.',
      },
    },
  })
  await appendPiRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'usage',
      provider: session.modelProvider,
      model: session.modelConfig ? (JSON.parse(session.modelConfig) as Record<string, unknown>).model : null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
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
  await db
    .update(sessions)
    .set({ status: 'error', statusReason: safeMessage, updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'runtime.proxy',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'failure',
    metadata: { message: safeMessage, status: response.status },
  })
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
  await appendPiRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: parsed,
  })
  const type = typeof parsed.type === 'string' ? parsed.type : 'message'
  if (type === 'response') {
    if (parsed.success === false) {
      const message = runtimeErrorMessage(parsed)
      await db
        .update(sessions)
        .set({ status: 'error', statusReason: message, updatedAt: new Date().toISOString() })
        .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
      return true
    }
    return false
  }
  if (type === 'agent_end') {
    await db
      .update(sessions)
      .set({ status: 'idle', statusReason: null, updatedAt: new Date().toISOString() })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    return true
  }
  if (type === 'bridge_exit') {
    const failed = parsed.code !== 0 && parsed.code !== null
    const status = failed ? 'error' : 'idle'
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
  return false
}

function runtimeErrorMessage(payload: Record<string, unknown>) {
  const error = payload.error
  if (typeof error === 'string') {
    return error
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  if (typeof payload.message === 'string') {
    return payload.message
  }
  return 'Runtime command failed'
}

async function drainPiRuntimeEvents(
  env: Env,
  sandboxId: string,
  request: Request,
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  onLine?: (line: string) => void,
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
        onLine?.(line)
        const terminal = await ingestPiRuntimeLine(db, auth, session, line)
        if (terminal) {
          await reader.cancel().catch(() => undefined)
          return
        }
      }
    }
    const final = `${pending}${decoder.decode()}`
    if (final.trim()) {
      onLine?.(final)
      await ingestPiRuntimeLine(db, auth, session, final)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function createWebSocketPair() {
  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
  return { client, server }
}

function sendRuntimeJson(socket: WebSocket, payload: Record<string, unknown>) {
  socket.send(JSON.stringify(payload))
}

async function handleTestRuntimeWebSocket(
  socket: WebSocket,
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  command: RuntimeCommand,
) {
  const commandId = command.id ?? newId('rpc')
  if (command.type === 'get_state') {
    sendRuntimeJson(socket, {
      type: 'session_info_changed',
      status: session.status,
      sessionId: session.id,
      sandboxId: session.sandboxId,
    })
    return
  }
  if (command.type === 'abort') {
    sendRuntimeJson(socket, { type: 'agent_end', willRetry: false, reason: 'aborted' })
    return
  }
  if (!command.message) {
    return
  }

  const correlationId = await recordRuntimeMessageSubmission(db, auth, session, command)
  const response = `Received: ${command.message}`
  const events = [
    { type: 'agent_start', sessionId: session.id },
    { type: 'turn_start', sessionId: session.id },
    { type: 'message_start', id: `${commandId}_assistant`, message: { role: 'assistant', content: '' } },
    {
      type: 'message_update',
      id: `${commandId}_assistant`,
      message: { role: 'assistant', content: response },
      assistantMessageEvent: { text: response },
    },
    {
      type: 'tool_execution_start',
      id: `${commandId}_tool`,
      toolCall: { id: `${commandId}_tool`, name: 'write_file', input: { path: 'ama-message.txt' } },
    },
    {
      type: 'tool_execution_end',
      id: `${commandId}_tool`,
      toolCall: {
        id: `${commandId}_tool`,
        name: 'write_file',
        input: { path: 'ama-message.txt' },
        output: { ok: true },
        durationMs: 8,
      },
    },
    {
      type: 'message_end',
      id: `${commandId}_assistant`,
      message: { role: 'assistant', content: response },
    },
    { type: 'turn_end', sessionId: session.id },
    { type: 'agent_end', sessionId: session.id, willRetry: false },
  ]
  for (const event of events) {
    sendRuntimeJson(socket, event)
  }
  await recordTestRuntimeMessageOutcome(db, auth, session, { ...command, response, toolCalls: [] }, correlationId)
}

async function handleRuntimeWebSocketMessage(
  socket: WebSocket,
  env: Env,
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  requestUrl: string,
  data: unknown,
) {
  let parsed: unknown
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : JSON.parse(String(data))
  } catch {
    socket.close(1003, 'Invalid runtime command JSON')
    return
  }
  const command = runtimeCommand(parsed)
  if (!command) {
    socket.close(1003, 'Invalid Pi runtime command')
    return
  }
  if (env.AMA_RUNTIME_MODE === 'test') {
    await handleTestRuntimeWebSocket(socket, db, auth, session, command)
    return
  }
  const rpcUrl = new URL(requestUrl)
  rpcUrl.pathname = `/runtime/sessions/${session.id}/rpc`
  const proxyRequest = new Request(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (command.type !== 'get_state') {
    await recordRuntimeMessageSubmission(db, auth, session, command)
  }
  const response = await proxyPiRuntime(env, session.sandboxId ?? '', proxyRequest)
  await recordRuntimeProxyFailure(db, auth, session, response.clone())
  if (!response.ok) {
    socket.close(1011, `Pi runtime returned ${response.status}`)
    return
  }
  if (response.ok) {
    await drainPiRuntimeEvents(env, session.sandboxId ?? '', proxyRequest, db, auth, session, (line) => {
      if (line.trim()) {
        socket.send(line.endsWith('\n') ? line : `${line}\n`)
      }
    })
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
    if (path === '/ws') {
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
        return errorResponse(c, 426, 'conflict', 'Runtime endpoint requires a WebSocket upgrade')
      }
      const { client, server } = createWebSocketPair()
      server.accept()
      server.addEventListener('message', (event) => {
        c.executionCtx.waitUntil(
          handleRuntimeWebSocketMessage(server, c.env, db, resolvedAuth, session, c.req.url, event.data).catch(() => {
            server.close(1011, 'Runtime processing failed')
          }),
        )
      })
      server.addEventListener('close', () => {
        server.close()
      })
      return new Response(null, { status: 101, webSocket: client })
    }
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
      const correlationId = await recordRuntimeMessageSubmission(db, resolvedAuth, session, body)
      if (c.env.AMA_RUNTIME_MODE === 'test') {
        await recordTestRuntimeMessageOutcome(db, resolvedAuth, session, body, correlationId)
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
