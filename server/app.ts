import { swaggerUI } from '@hono/swagger-ui'
import { and, eq, max } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { cors } from 'hono/cors'
import { piEventTypeFromPayload } from '../shared/pi-events'
import { recordAudit, requestId } from './audit'
import { type AuthContext, requireAuth } from './auth/session'
import { sessionEvents, sessions } from './db/schema'
import type { Env } from './env'
import { errorResponse } from './errors'
import { ApiSecuritySchemes, createApiRouter } from './openapi'
import { evaluateMcpToolPolicy, evaluateSandboxRuntimePolicy, type PolicyDecision } from './policy'
import { redactSensitiveValue } from './redaction'
import agents from './routes/agents'
import audit from './routes/audit'
import e2e from './routes/e2e'
import environments from './routes/environments'
import governance from './routes/governance'
import health from './routes/health'
import mcp from './routes/mcp'
import projects from './routes/projects'
import providers from './routes/providers'
import runtimeAi from './routes/runtime-ai'
import sessionRoutes, { recoverSessionRuntime } from './routes/sessions'
import usage from './routes/usage'
import vaults from './routes/vaults'
import { proxyPiRuntime } from './runtime/pi/bridge'

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

const RUNTIME_COMMAND_PROXY_TIMEOUT_MS = 30_000

function redactRuntimeValue(value: unknown): unknown {
  return redactSensitiveValue(value)
}

function piEventType(event: Record<string, unknown>) {
  return piEventTypeFromPayload(event)
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
    metadata?: Record<string, unknown>
  },
) {
  await appendPiRuntimeEvent(db, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: {
      type: 'policy_denied',
      ...values.payload,
    },
    metadata: { source: 'policy', ...(values.metadata ?? {}) },
  })
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

function hostFromUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

function firstCommandWord(command: string | null, fallback: string) {
  return command?.trim().split(/\s+/)[0] ?? fallback
}

function sandboxOperationFromToolCall(call: Record<string, unknown>) {
  const name = typeof call.name === 'string' ? call.name : ''
  const input = call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {}
  if (name === 'sandbox.exec' || name === 'shell.exec' || name === 'terminal.exec') {
    const command = typeof input.command === 'string' ? input.command : null
    return {
      operation: 'command' as const,
      command,
      resourceType: 'sandbox_command',
      resourceId: firstCommandWord(command, name),
    }
  }
  if (name === 'sandbox.fetch' || name === 'network.fetch' || name === 'web.fetch') {
    const host = typeof input.host === 'string' ? input.host : hostFromUrl(input.url)
    return { operation: 'network' as const, host, resourceType: 'sandbox_network', resourceId: host ?? name }
  }
  return null
}

function sandboxOperationFromRuntimePath(path: string, body: unknown) {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (path === '/sandbox/exec' || path === '/sandbox/commands') {
    const command = typeof record.command === 'string' ? record.command : null
    return {
      operation: 'command' as const,
      command,
      resourceType: 'sandbox_command',
      resourceId: firstCommandWord(command, path),
    }
  }
  if (path === '/sandbox/network' || path === '/sandbox/fetch') {
    const host = typeof record.host === 'string' ? record.host : hostFromUrl(record.url)
    return { operation: 'network' as const, host, resourceType: 'sandbox_network', resourceId: host ?? path }
  }
  return null
}

async function denyRuntimePolicy(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  values: {
    sessionId: string
    decision: PolicyDecision
    requestId?: string | null
    action: string
    resourceType: string
    resourceId: string | null
    payload: Record<string, unknown>
  },
) {
  const payload = {
    category: values.decision.category,
    ruleId: values.decision.rule,
    resourceType: values.resourceType,
    resourceId: values.resourceId,
    decision: values.decision,
    ...values.payload,
  }
  await appendRuntimePolicyEvent(db, { auth, sessionId: values.sessionId, payload })
  await recordAudit(db, {
    auth,
    action: values.action,
    resourceType: values.resourceType,
    resourceId: values.resourceId,
    outcome: 'denied',
    requestId: values.requestId ?? null,
    sessionId: values.sessionId,
    policyCategory: values.decision.category,
    metadata: payload,
  })
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

async function evaluateRuntimeSandboxOperations(
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  body: unknown,
) {
  for (const call of runtimeToolCalls(body)) {
    const operation = sandboxOperationFromToolCall(call)
    if (!operation) {
      continue
    }
    const decision = await evaluateSandboxRuntimePolicy(db, auth, {
      session: {
        id: session.id,
        agentSnapshot: session.agentSnapshot,
        environmentSnapshot: session.environmentSnapshot,
      },
      operation: operation.operation,
      command: 'command' in operation ? operation.command : null,
      host: 'host' in operation ? operation.host : null,
    })
    if (!decision.allowed) {
      return {
        decision,
        operation,
      }
    }
  }
  return null
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

function isRecoverableRuntimeStatus(status: number) {
  return status === 500 || status === 502 || status === 503 || status === 504
}

async function runtimeRequestFactory(request: Request) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().arrayBuffer()
  return () => {
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
    }
    if (body) {
      init.body = body.slice(0)
    }
    return new Request(request.url, init)
  }
}

async function proxyPiRuntimeCommand(
  env: Env,
  db: ReturnType<typeof drizzle>,
  auth: AuthContext,
  session: typeof sessions.$inferSelect,
  makeRequest: () => Request,
) {
  let recovered = false
  let response: Response
  try {
    response = await proxyPiRuntimeCommandAttempt(env, session.sandboxId ?? '', makeRequest())
  } catch {
    await recoverSessionRuntime(env, db, auth, session)
    recovered = true
    response = await proxyPiRuntimeCommandAttempt(env, session.sandboxId ?? '', makeRequest()).catch(() =>
      Response.json({ error: { type: 'runtime_error', message: 'Pi runtime command timed out' } }, { status: 504 }),
    )
  }
  if (!recovered && !response.ok && isRecoverableRuntimeStatus(response.status)) {
    await recoverSessionRuntime(env, db, auth, session)
    recovered = true
    response = await proxyPiRuntimeCommandAttempt(env, session.sandboxId ?? '', makeRequest()).catch(() =>
      Response.json({ error: { type: 'runtime_error', message: 'Pi runtime command timed out' } }, { status: 504 }),
    )
  }
  return { response, recovered }
}

async function proxyPiRuntimeCommandAttempt(env: Env, sandboxId: string, request: Request) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      proxyPiRuntime(env, sandboxId, request),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Pi runtime command timed out')), RUNTIME_COMMAND_PROXY_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
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
  const type = piEventType(parsed)
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
  cursor?: number | 'latest' | null,
  onLine?: (line: string) => void,
  options: { persist?: boolean; stopOnTerminal?: boolean; signal?: AbortSignal } = {},
) {
  const streamUrl = new URL(request.url)
  if (cursor === 'latest') {
    streamUrl.searchParams.set('cursor', cursor)
  } else if (typeof cursor === 'number' && Number.isFinite(cursor)) {
    streamUrl.searchParams.set('cursor', String(cursor))
  }
  const streamRequest = new Request(streamUrl, {
    method: 'GET',
    headers: request.headers,
    ...(options.signal ? { signal: options.signal } : {}),
  })
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
        if (options.persist === false) {
          continue
        }
        const terminal = await ingestPiRuntimeLine(db, auth, session, line)
        if (terminal && options.stopOnTerminal !== false) {
          await reader.cancel().catch(() => undefined)
          return
        }
      }
    }
    const final = `${pending}${decoder.decode()}`
    if (final.trim()) {
      onLine?.(final)
      if (options.persist === false) {
        return
      }
      const terminal = await ingestPiRuntimeLine(db, auth, session, final)
      if (terminal && options.stopOnTerminal !== false) {
        await reader.cancel().catch(() => undefined)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

async function runtimeEventCursor(response: Response) {
  const payload = await response.json().catch((): unknown => null)
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const cursor = (payload as Record<string, unknown>).eventCursor
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : null
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
  rpcUrl.searchParams.delete('access_token')
  const proxyRequest = new Request(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (command.type !== 'get_state') {
    await recordRuntimeMessageSubmission(db, auth, session, command)
  }
  const makeRequest = await runtimeRequestFactory(proxyRequest)
  const { response, recovered } = await proxyPiRuntimeCommand(env, db, auth, session, makeRequest)
  await recordRuntimeProxyFailure(db, auth, session, response.clone())
  if (!response.ok) {
    socket.close(1011, `Pi runtime returned ${response.status}`)
    return
  }
  if (recovered) {
    const cursor = await runtimeEventCursor(response.clone())
    await drainPiRuntimeEvents(env, session.sandboxId ?? '', makeRequest(), db, auth, session, cursor, (line) => {
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
      allowHeaders: ['Content-Type', 'Authorization', 'X-AMA-Project-ID'],
      credentials: true,
    }),
  )

  const routes = app
    .route('/api/health', health)
    .route('/api/e2e', e2e)
    .route('/api/projects', projects)
    .route('/api/agents', agents)
    .route('/api/environments', environments)
    .route('/api/providers', providers)
    .route('/api/runtime', runtimeAi)
    .route('/api/governance', governance)
    .route('/api/mcp', mcp)
    .route('/api/usage', usage)
    .route('/api/audit-records', audit)
    .route('/api/sessions', sessionRoutes)
    .route('/api/vaults', vaults)

  routes.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', ApiSecuritySchemes.bearerAuth)

  routes.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Any Managed Agents API',
      version: '0.1.0',
      description:
        'Control-plane API for Any Managed Agents. Command-line automation uses restish or direct HTTP against this OpenAPI document; runtime traffic remains Pi-compatible through AMA runtime proxy endpoints.',
    },
    servers: [{ url: '/' }],
  })

  routes.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }))

  routes.all('/runtime/sessions/:sessionId/*', async (c) => {
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
      const streamController = new AbortController()
      const streamUrl = new URL(c.req.url)
      streamUrl.pathname = `/runtime/sessions/${session.id}/rpc`
      streamUrl.searchParams.delete('access_token')
      const streamRequest = new Request(streamUrl, {
        method: 'GET',
        headers: c.req.raw.headers,
        signal: streamController.signal,
      })
      c.executionCtx.waitUntil(
        drainPiRuntimeEvents(
          c.env,
          session.sandboxId,
          streamRequest,
          db,
          resolvedAuth,
          session,
          'latest',
          (line) => {
            if (line.trim()) {
              server.send(line.endsWith('\n') ? line : `${line}\n`)
            }
          },
          { stopOnTerminal: false, signal: streamController.signal },
        ).catch((error) => {
          if (!streamController.signal.aborted) {
            sendRuntimeJson(server, { type: 'error', message: error instanceof Error ? error.message : String(error) })
          }
        }),
      )
      server.addEventListener('message', (event) => {
        c.executionCtx.waitUntil(
          handleRuntimeWebSocketMessage(server, c.env, db, resolvedAuth, session, c.req.url, event.data).catch(() => {
            server.close(1011, 'Runtime processing failed')
          }),
        )
      })
      server.addEventListener('close', () => {
        streamController.abort()
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
        await denyRuntimePolicy(db, resolvedAuth, {
          sessionId,
          decision,
          requestId: requestId(c),
          action: 'runtime_mcp_tool.call',
          resourceType: decision.category === 'tool' ? 'tool' : 'mcp_connector',
          resourceId: decision.category === 'tool' ? toolName : connectorId,
          payload: { operation: 'mcp_tool_call', connectorId, toolName },
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
      const sandboxPolicyDenial = await evaluateRuntimeSandboxOperations(db, resolvedAuth, session, body)
      if (sandboxPolicyDenial) {
        await denyRuntimePolicy(db, resolvedAuth, {
          sessionId,
          decision: sandboxPolicyDenial.decision,
          requestId: requestId(c),
          action: 'runtime_sandbox.operation',
          resourceType: sandboxPolicyDenial.operation.resourceType,
          resourceId: sandboxPolicyDenial.operation.resourceId,
          payload: {
            operation: sandboxPolicyDenial.operation.operation,
            command: 'command' in sandboxPolicyDenial.operation ? sandboxPolicyDenial.operation.command : undefined,
            host: 'host' in sandboxPolicyDenial.operation ? sandboxPolicyDenial.operation.host : undefined,
          },
        })
        return errorResponse(c, 403, 'policy_denied', sandboxPolicyDenial.decision.message, {
          category: sandboxPolicyDenial.decision.category,
          resourceType: sandboxPolicyDenial.operation.resourceType,
          resourceId: sandboxPolicyDenial.operation.resourceId,
          ruleId: sandboxPolicyDenial.decision.rule,
        })
      }
      const correlationId = await recordRuntimeMessageSubmission(db, resolvedAuth, session, body)
      if (c.env.AMA_RUNTIME_MODE === 'test') {
        await recordTestRuntimeMessageOutcome(db, resolvedAuth, session, body, correlationId)
      }
    } else {
      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? {}
          : await request
              .clone()
              .json()
              .catch(() => ({}))
      const operation = sandboxOperationFromRuntimePath(path, body)
      if (operation) {
        const decision = await evaluateSandboxRuntimePolicy(db, resolvedAuth, {
          session: {
            id: session.id,
            agentSnapshot: session.agentSnapshot,
            environmentSnapshot: session.environmentSnapshot,
          },
          operation: operation.operation,
          command: 'command' in operation ? operation.command : null,
          host: 'host' in operation ? operation.host : null,
        })
        if (!decision.allowed) {
          await denyRuntimePolicy(db, resolvedAuth, {
            sessionId,
            decision,
            requestId: requestId(c),
            action: 'runtime_sandbox.operation',
            resourceType: operation.resourceType,
            resourceId: operation.resourceId,
            payload: {
              operation: operation.operation,
              command: 'command' in operation ? operation.command : undefined,
              host: 'host' in operation ? operation.host : undefined,
            },
          })
          return errorResponse(c, 403, 'policy_denied', decision.message, {
            category: decision.category,
            resourceType: operation.resourceType,
            resourceId: operation.resourceId,
            ruleId: decision.rule,
          })
        }
      }
    }

    const makeRequest = await runtimeRequestFactory(request)
    const { response } =
      path === '/rpc' && request.method === 'POST'
        ? await proxyPiRuntimeCommand(c.env, db, resolvedAuth, session, makeRequest)
        : { response: await proxyPiRuntime(c.env, session.sandboxId, makeRequest()) }
    const cursor = path === '/rpc' && request.method === 'POST' ? await runtimeEventCursor(response.clone()) : null
    if (path === '/rpc' && request.method === 'POST') {
      await recordRuntimeProxyFailure(db, resolvedAuth, session, response.clone())
      if (response.ok && c.env.AMA_RUNTIME_MODE !== 'test') {
        c.executionCtx.waitUntil(
          drainPiRuntimeEvents(c.env, session.sandboxId, request, db, resolvedAuth, session, cursor),
        )
      }
    }
    return response
  })

  routes.notFound((c) => c.json({ error: { type: 'not_found', message: 'Not found' } }, 404))

  routes.onError((err, c) => {
    console.error(err)
    return c.json({ error: { type: 'internal_error', message: 'Internal server error' } }, 500)
  })

  return routes
}

export type AppType = ReturnType<typeof createApp>
