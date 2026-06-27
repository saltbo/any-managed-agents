import type { ExternalRuntimeName } from './runtime-names'
import type { AmaSessionEventType } from './session-events'

export type RuntimeBridgeRequest = {
  type: 'run'
  requestId: string
  runtime: ExternalRuntimeName
  sessionId: string
  cwd: string
  env: Record<string, string>
  prompt: string
  provider?: string
  model?: string
  agentSnapshot?: Record<string, unknown>
  runtimeConfig?: Record<string, unknown>
  resumeToken?: string
  resume?: boolean
}

export type RuntimeBridgeControl = {
  type: 'abort' | 'send' | 'permissionDecision'
  requestId: string
  message?: string
  permissionId?: string
  allowed?: boolean
  reason?: string
}

export type RuntimeBridgeUsageRequest = {
  type: 'fetchUsage'
  requestId: string
  runtime: ExternalRuntimeName
  env: Record<string, string>
}

export type RuntimeBridgeModelsRequest = {
  type: 'detectModels'
  requestId: string
  runtime: ExternalRuntimeName
  env: Record<string, string>
}

export type RuntimeBridgeInput =
  | RuntimeBridgeRequest
  | RuntimeBridgeControl
  | RuntimeBridgeUsageRequest
  | RuntimeBridgeModelsRequest

export type RuntimeUsageWindow = {
  label: string
  utilization: number
  resetsAt: string
}

export type AmaRuntimeEvent = {
  type: AmaSessionEventType
  payload: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type RuntimeBridgeOutput =
  | { type: 'ready' }
  | {
      type: 'sessionEvent'
      requestId: string
      eventType: AmaSessionEventType
      payload: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  | { type: 'resumeToken'; requestId: string; resumeToken: string }
  | { type: 'result'; requestId: string; result: Record<string, unknown> }
  | { type: 'error'; requestId: string; error: { message: string; code?: string; details?: unknown } }
