import { canonicalAmaSessionEventFromRuntimeEvent } from '@shared/session-events'
import type { Context, Env as HonoEnv } from 'hono'
import {
  createRuntimeOrchestrationRepo,
  type RuntimeOrchestrationRepo,
  type SessionRow,
} from '../adapters/repos/runtime-orchestration'
import { type AuthContext, requireAuth } from '../auth/session'
import { createDb } from '../db/client'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { requestId } from '../http/request-context'
import { evaluateMcpToolPolicy, evaluateSandboxRuntimePolicy } from '../policy'
import { redactSensitiveValue } from '../redaction'
import { dispatchRunnerSessionCommand, hasAcceptedRunnerSessionChannel } from './runner-session-command'
import {
  denyRuntimePolicy,
  evaluateRuntimeSandboxOperations,
  newId,
  type RuntimeCommand,
  runtimeCommand,
  runtimeRequestHasTestOnlyFields,
  sandboxOperationFromRuntimePath,
} from './runtime-proxy-policy'
import {
  markRuntimeExecutionFailed,
  recordRuntimeMessageOutcome,
  recordRuntimeMessageSubmission,
} from './runtime-proxy-turn'
import { executeRuntimeToolCalls, isRuntimeTurnCancelled } from './session-runtime'

// The env-bound /api/v1/runtime data-plane proxy. Its wire shape is dictated by
// external protocols (ACP tunnel, OpenAI-compatible inference, WebSocket RPC),
// so it is exempt from REST resource modeling (docs/api-v1-design.md §1.8). It
// stays drizzle-free by routing every session read/write through the runtime
// orchestration repo; the http layer only registers it (server/http/runtime-proxy.ts).

// Runtime-request validation lives with the policy module; re-exported here so
// existing consumers keep importing it from the transport entrypoint.
export { runtimeRequestHasTestOnlyFields } from './runtime-proxy-policy'

type Repo = RuntimeOrchestrationRepo

function redactRuntimeValue(value: unknown): unknown {
  return redactSensitiveValue(value)
}

function createWebSocketPair() {
  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
  return { client, server }
}

function sendRuntimeJson(socket: WebSocket, payload: Record<string, unknown>) {
  const event = canonicalAmaSessionEventFromRuntimeEvent(payload, { source: 'runtime-websocket' })
  socket.send(
    JSON.stringify({
      type: event.type,
      ...(redactRuntimeValue(event.payload) as Record<string, unknown>),
      metadata: redactRuntimeValue(event.metadata),
    }),
  )
}

async function handleTestRuntimeWebSocket(
  socket: WebSocket,
  repo: Repo,
  auth: AuthContext,
  session: SessionRow,
  command: RuntimeCommand,
) {
  const commandId = command.id ?? newId('rpc')
  if (command.type === 'get_state') {
    sendRuntimeJson(socket, {
      type: 'session_info_changed',
      status: session.state,
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

  const correlationId = await recordRuntimeMessageSubmission(repo, auth, session, command)
  const response = `AMA runtime processed: ${command.message}`
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
        output: { ok: true, token: 'raw-secret-token' },
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
  await recordRuntimeMessageOutcome(
    repo,
    { AMA_RUNTIME_MODE: 'test' } as Env,
    auth,
    session,
    {
      ...command,
      response,
      toolCalls: [],
    },
    correlationId,
    { executeTools: true },
  )
}

async function handleRuntimeWebSocketMessage(
  socket: WebSocket,
  env: Env,
  repo: Repo,
  auth: AuthContext,
  session: SessionRow,
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
    socket.close(1003, 'Invalid runtime command')
    return
  }
  if (env.AMA_RUNTIME_MODE === 'test') {
    await handleTestRuntimeWebSocket(socket, repo, auth, session, command)
    return
  }
  if (command.type !== 'get_state') {
    const correlationId = await recordRuntimeMessageSubmission(repo, auth, session, command)
    try {
      await recordRuntimeMessageOutcome(repo, env, auth, session, command, correlationId, { executeTools: false })
    } catch (error) {
      await markRuntimeExecutionFailed(repo, auth, session, error)
      socket.close(1011, 'Runtime processing failed')
      return
    }
  }
  sendRuntimeJson(socket, {
    type: command.type === 'get_state' ? 'session_info_changed' : 'agent_end',
    sessionId: session.id,
    status: command.type === 'get_state' ? session.state : 'idle',
    willRetry: false,
  })
}

// Single per-request entrypoint for the runtime data-plane proxy. Owns the
// session read, the runtime state guards, the WebSocket upgrade, and the
// protocol response shapes; routes every persistence touch through the runtime
// orchestration repo so this file imports no drizzle or schema.
export async function handleRuntimeProxyRequest<E extends HonoEnv>(
  c: Context<E & { Bindings: Env }>,
): Promise<Response> {
  const repo = createRuntimeOrchestrationRepo(createDb(c.env))
  const resolvedAuth = await requireAuth(c)
  if (resolvedAuth instanceof Response) {
    return resolvedAuth
  }

  const sessionId = c.req.param('sessionId')
  if (!sessionId) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  const session = await repo.findSession(resolvedAuth.project.id, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  if (session.state !== 'idle' && session.state !== 'running') {
    return errorResponse(c, 409, 'conflict', 'Session runtime is not active')
  }
  const path = c.req.path.replace(`/api/v1/runtime/sessions/${sessionId}`, '')
  if (!session.sandboxId) {
    if (path === '/rpc' && c.req.method === 'POST' && (await hasAcceptedRunnerSessionChannel(c.env, session.id))) {
      const body = await c.req.raw
        .clone()
        .json()
        .catch(() => ({}))
      if (c.env.AMA_RUNTIME_MODE !== 'test' && runtimeRequestHasTestOnlyFields(body)) {
        return errorResponse(
          c,
          400,
          'validation_error',
          'Runtime clients cannot submit tool calls, tool results, or simulated runtime outcomes',
        )
      }
      const sandboxPolicyDenial = await evaluateRuntimeSandboxOperations(repo, resolvedAuth, session, body)
      if (sandboxPolicyDenial) {
        await denyRuntimePolicy(repo, resolvedAuth, {
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
      const dispatched = await dispatchRunnerSessionCommand(c.env, session.id, {
        id: newId('runnercmd'),
        type: 'runtime.rpc',
        path,
        body: redactRuntimeValue(body),
      })
      if (!dispatched) {
        return errorResponse(c, 409, 'conflict', 'Runner session channel is unavailable')
      }
      return Response.json({ runtime: 'self-hosted-runner', accepted: true, sessionId: session.id, path })
    }
    return errorResponse(c, 409, 'conflict', 'Session runtime is unavailable')
  }

  if (path === '/ws') {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return errorResponse(c, 426, 'conflict', 'Runtime endpoint requires a WebSocket upgrade')
    }
    const { client, server } = createWebSocketPair()
    server.accept()
    server.addEventListener('message', (event) => {
      c.executionCtx.waitUntil(
        handleRuntimeWebSocketMessage(server, c.env, repo, resolvedAuth, session, event.data).catch(() => {
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
    const decision = await evaluateMcpToolPolicy(repo.db, resolvedAuth, {
      connectorId,
      toolName,
      session: {
        id: session.id,
        agentSnapshot: session.agentSnapshot,
        environmentSnapshot: session.environmentSnapshot,
      },
    })
    if (!decision.allowed) {
      await denyRuntimePolicy(repo, resolvedAuth, {
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
    if (c.env.AMA_RUNTIME_MODE !== 'test' && runtimeRequestHasTestOnlyFields(body)) {
      return errorResponse(
        c,
        400,
        'validation_error',
        'Runtime clients cannot submit tool calls, tool results, or simulated runtime outcomes',
      )
    }
    const sandboxPolicyDenial = await evaluateRuntimeSandboxOperations(repo, resolvedAuth, session, body)
    if (sandboxPolicyDenial) {
      await denyRuntimePolicy(repo, resolvedAuth, {
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
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    if (typeof record.message !== 'string' || !record.message.trim()) {
      return Response.json({
        runtime: 'ama-cloud',
        accepted: true,
        sandboxId: session.sandboxId,
        path,
      })
    }
    const correlationId = await recordRuntimeMessageSubmission(repo, resolvedAuth, session, body)
    try {
      await recordRuntimeMessageOutcome(repo, c.env, resolvedAuth, session, body, correlationId, {
        executeTools: c.env.AMA_RUNTIME_MODE === 'test',
      })
    } catch (error) {
      if (isRuntimeTurnCancelled(error)) {
        return errorResponse(c, 409, 'conflict', 'Session runtime is no longer active')
      }
      const runtimeError = await markRuntimeExecutionFailed(repo, resolvedAuth, session, error)
      return errorResponse(c, 500, 'internal_error', runtimeError.message, { runtime: runtimeError })
    }
    return Response.json({
      runtime: 'ama-cloud',
      accepted: true,
      sandboxId: session.sandboxId,
      path,
    })
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
      const decision = await evaluateSandboxRuntimePolicy(repo.db, resolvedAuth, {
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
        await denyRuntimePolicy(repo, resolvedAuth, {
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
    if (operation?.operation === 'command' && request.method === 'POST' && c.env.AMA_RUNTIME_MODE === 'test') {
      let result: Awaited<ReturnType<typeof executeRuntimeToolCalls>>
      try {
        result = await executeRuntimeToolCalls(c.env, {
          sessionId: session.id,
          sandboxId: session.sandboxId,
          body: {
            toolCalls: [
              {
                id: newId('tool'),
                name: 'sandbox.exec',
                input: { command: operation.command },
              },
            ],
          },
        })
      } catch (error) {
        const runtimeError = await markRuntimeExecutionFailed(repo, resolvedAuth, session, error)
        return errorResponse(c, 500, 'internal_error', runtimeError.message, { runtime: runtimeError })
      }
      return Response.json({ runtime: 'ama-cloud', result: result[0] ?? null })
    }
  }
  return Response.json({ runtime: 'ama-cloud', sessionId: session.id, path })
}
