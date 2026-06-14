import type { SessionRow } from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import { evaluateSandboxRuntimePolicy, type PolicyDecision } from '../policy'
import type { AuthScope } from '../usecases/ports'
import { appendRuntimeEvent, type Repo } from './session-base'

async function appendRuntimePolicyEvent(
  repo: Repo,
  values: {
    auth: AuthScope
    sessionId: string
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  },
) {
  await appendRuntimeEvent(repo, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: {
      type: 'policy_denied',
      ...values.payload,
    },
    metadata: { source: 'policy', ...(values.metadata ?? {}) },
  })
  await recordAudit(repo.db, {
    auth: values.auth,
    action: 'runtime.policy',
    resourceType: 'session',
    resourceId: values.sessionId,
    outcome: 'denied',
    metadata: values.payload,
  })
}

export type RuntimeCommand = {
  id?: string
  type: 'get_state' | 'prompt' | 'steer' | 'follow_up' | 'abort'
  message?: string
}

export function runtimeCommand(body: unknown): RuntimeCommand | null {
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

export function runtimeToolCalls(body: unknown) {
  if (!body || typeof body !== 'object') {
    return []
  }
  const calls = (body as Record<string, unknown>).toolCalls
  return Array.isArray(calls)
    ? calls.filter((call): call is Record<string, unknown> => !!call && typeof call === 'object')
    : []
}

export function runtimeRequestHasTestOnlyFields(body: unknown) {
  if (!body || typeof body !== 'object') {
    return false
  }
  const record = body as Record<string, unknown>
  return (
    'toolCalls' in record ||
    'response' in record ||
    'simulateError' in record ||
    'errorMessage' in record ||
    'output' in record ||
    'error' in record
  )
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

function commandOperation(command: string | null, fallbackResourceId: string) {
  return {
    operation: 'command' as const,
    command,
    resourceType: 'sandbox_command',
    resourceId: firstCommandWord(command, fallbackResourceId),
  }
}

function networkOperation(host: string | null, fallbackResourceId: string) {
  return {
    operation: 'network' as const,
    host,
    resourceType: 'sandbox_network',
    resourceId: host ?? fallbackResourceId,
  }
}

export type SandboxOperation = ReturnType<typeof commandOperation> | ReturnType<typeof networkOperation>

export function sandboxOperationFromToolCall(call: Record<string, unknown>) {
  const name = typeof call.name === 'string' ? call.name : ''
  const input = call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {}
  if (name === 'sandbox.exec' || name === 'shell.exec' || name === 'terminal.exec') {
    const command = typeof input.command === 'string' ? input.command : null
    return commandOperation(command, name)
  }
  if (name === 'sandbox.fetch' || name === 'network.fetch' || name === 'web.fetch') {
    const host = typeof input.host === 'string' ? input.host : hostFromUrl(input.url)
    return networkOperation(host, name)
  }
  return null
}

export function sandboxOperationFromRuntimePath(path: string, body: unknown) {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (path === '/sandbox/exec' || path === '/sandbox/commands') {
    const command = typeof record.command === 'string' ? record.command : null
    return commandOperation(command, path)
  }
  if (path === '/sandbox/network' || path === '/sandbox/fetch') {
    const host = typeof record.host === 'string' ? record.host : hostFromUrl(record.url)
    return networkOperation(host, path)
  }
  return null
}

export type RuntimeRoute =
  | { kind: 'ws' }
  | { kind: 'mcpToolCall'; connectorId: string; toolName: string }
  | { kind: 'rpc' }
  | { kind: 'passthrough' }

export function parseRuntimeProxyRoute(path: string, method: string): RuntimeRoute {
  if (path === '/ws') {
    return { kind: 'ws' }
  }
  const mcpMatch = path.match(/^\/mcp\/([^/]+)\/tools\/([^/]+)\/calls$/)
  if (mcpMatch && method === 'POST') {
    return {
      kind: 'mcpToolCall',
      connectorId: decodeURIComponent(mcpMatch[1] ?? ''),
      toolName: decodeURIComponent(mcpMatch[2] ?? ''),
    }
  }
  if (path === '/rpc' && method === 'POST') {
    return { kind: 'rpc' }
  }
  return { kind: 'passthrough' }
}

export async function denyRuntimePolicy(
  repo: Repo,
  auth: AuthScope,
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
  await appendRuntimePolicyEvent(repo, { auth, sessionId: values.sessionId, payload })
  await recordAudit(repo.db, {
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

export async function evaluateRuntimeSandboxOperations(
  repo: Repo,
  auth: AuthScope,
  session: SessionRow,
  body: unknown,
) {
  for (const call of runtimeToolCalls(body)) {
    const operation = sandboxOperationFromToolCall(call)
    if (!operation) {
      continue
    }
    const decision = await evaluateSandboxRuntimePolicy(repo.db, auth, {
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
