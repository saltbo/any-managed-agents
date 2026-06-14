import { canonicalAmaSessionEventFromRuntimeEvent } from '@shared/session-events'
import type { Context, Env as HonoEnv } from 'hono'
import { createRuntimeOrchestrationRepo, type SessionRow } from '../adapters/repos/runtime-orchestration'
import { requireAuth } from '../auth/session'
import { createDb } from '../db/client'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { requestId } from '../http/request-context'
import { evaluateMcpToolPolicy, evaluateSandboxRuntimePolicy, type PolicyDecision } from '../policy'
import { redactSensitiveValue } from '../redaction'
import type { AuthScope } from '../usecases/ports'
import { dispatchRunnerSessionCommand, hasAcceptedRunnerSessionChannel } from './runner-session-command'
import {
  denyRuntimePolicy,
  evaluateRuntimeSandboxOperations,
  parseRuntimeProxyRoute,
  type RuntimeCommand,
  runtimeCommand,
  runtimeRequestHasTestOnlyFields,
  type SandboxOperation,
  sandboxOperationFromRuntimePath,
} from './runtime-proxy-policy'
import { newId, type Repo } from './session-base'
import { executeRuntimeToolCalls, isRuntimeTurnCancelled } from './session-runtime'
import { markRuntimeExecutionFailed, recordRuntimeMessageOutcome, recordRuntimeMessageSubmission } from './turn-driver'

// The env-bound /api/v1/runtime data-plane proxy. Its wire shape is dictated by
// external protocols (ACP tunnel, OpenAI-compatible inference, WebSocket RPC),
// so it is exempt from REST resource modeling (docs/api-v1-design.md §1.8). It
// stays drizzle-free by routing every session read/write through the runtime
// orchestration repo; the http layer only registers it (server/http/runtime-proxy.ts).

function redactRuntimeValue(value: unknown): unknown {
  return redactSensitiveValue(value)
}

async function readRuntimeJsonBody(request: Request): Promise<unknown> {
  return request
    .clone()
    .json()
    .catch(() => ({}))
}

async function denySandboxOperation<E extends HonoEnv>(
  c: Context<E & { Bindings: Env }>,
  repo: Repo,
  auth: AuthScope,
  sessionId: string,
  requestIdValue: string | null,
  decision: PolicyDecision,
  operation: SandboxOperation,
): Promise<Response> {
  await denyRuntimePolicy(repo, auth, {
    sessionId,
    decision,
    requestId: requestIdValue,
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

function createWebSocketPair() {
  const pair = new WebSocketPair()
  return { client: pair[0], server: pair[1] }
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
  auth: AuthScope,
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

  await recordRuntimeMessageSubmission(repo, auth, session)
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
  await recordRuntimeMessageOutcome(repo, { AMA_RUNTIME_MODE: 'test' } as Env, auth, session, {
    ...command,
    response,
    toolCalls: [],
  })
}

async function handleRuntimeWebSocketMessage(
  socket: WebSocket,
  env: Env,
  repo: Repo,
  auth: AuthScope,
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
    await recordRuntimeMessageSubmission(repo, auth, session)
    try {
      await recordRuntimeMessageOutcome(repo, env, auth, session, command)
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
      const body = await readRuntimeJsonBody(c.req.raw)
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
        return denySandboxOperation(
          c,
          repo,
          resolvedAuth,
          sessionId,
          requestId(c),
          sandboxPolicyDenial.decision,
          sandboxPolicyDenial.operation,
        )
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

  const request = c.req.raw
  const route = parseRuntimeProxyRoute(path, c.req.method)
  switch (route.kind) {
    case 'ws': {
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
    case 'mcpToolCall': {
      const { connectorId, toolName } = route
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
      // An allowed MCP tool call falls through to the passthrough handler below.
      break
    }
    case 'rpc': {
      const body = await readRuntimeJsonBody(request)
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
        return denySandboxOperation(
          c,
          repo,
          resolvedAuth,
          sessionId,
          requestId(c),
          sandboxPolicyDenial.decision,
          sandboxPolicyDenial.operation,
        )
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
      await recordRuntimeMessageSubmission(repo, resolvedAuth, session)
      try {
        await recordRuntimeMessageOutcome(repo, c.env, resolvedAuth, session, body)
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
    }
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readRuntimeJsonBody(request)
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
      return denySandboxOperation(c, repo, resolvedAuth, sessionId, requestId(c), decision, operation)
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
  return Response.json({ runtime: 'ama-cloud', sessionId: session.id, path })
}
