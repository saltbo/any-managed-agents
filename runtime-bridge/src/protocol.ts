import type { AmaSessionEventType } from '../../shared/session-events'

export type RuntimeBridgeRequest = {
  type: 'run'
  requestId: string
  runtime: 'codex' | 'claude-code' | 'copilot'
  sessionId: string
  cwd: string
  env: Record<string, string>
  prompt: string
  provider?: string
  model?: string
  runtimeConfig?: Record<string, unknown>
  resumeToken?: string
  resume?: boolean
}

export type RuntimeBridgeControl = {
  type: 'abort' | 'send'
  requestId: string
  message?: string
}

export type RuntimeBridgeInput = RuntimeBridgeRequest | RuntimeBridgeControl

export type AmaRuntimeEvent = {
  type: AmaSessionEventType
  payload: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type RuntimeBridgeOutput =
  | { type: 'ready' }
  | { type: 'event'; requestId: string; event: AmaRuntimeEvent }
  | { type: 'result'; requestId: string; result: Record<string, unknown> }
  | { type: 'error'; requestId: string; error: { message: string; code?: string; details?: unknown } }
  | { type: 'log'; requestId?: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }

export type RuntimeProviderHandle = {
  events: AsyncIterable<AmaRuntimeEvent>
  abort(): Promise<void>
  send(message: string): Promise<void>
  getResumeToken?(): string | undefined
}

export type RuntimeProviderRequest = RuntimeBridgeRequest

export type RuntimeProvider = {
  readonly name: RuntimeBridgeRequest['runtime']
  execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle>
}

export function bridgeError(message: string, code?: string, details?: unknown) {
  return { message, ...(code ? { code } : {}), ...(details !== undefined ? { details } : {}) }
}
