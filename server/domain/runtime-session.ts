import type { RuntimeName } from './runtime-catalog'
import type { SessionHostingMode } from './session'

// Pure session-runtime rules extracted from the env-bound orchestration layer:
// they read session metadata and environment snapshots with no D1/platform
// dependency, so they live in domain and are unit-tested directly.

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function sessionRuntimeFromMetadata(metadata: Record<string, unknown>): RuntimeName {
  const runtime = metadata.runtime
  if (typeof runtime !== 'string') {
    throw new Error('Session runtime metadata is required')
  }
  return runtime as RuntimeName
}

export function sessionRuntimeConfig(metadata: Record<string, unknown>): Record<string, unknown> {
  return objectValue(metadata.runtimeConfig)
}

export function environmentHostingMode(snapshot: { type?: unknown } | null): SessionHostingMode {
  return snapshot?.type === 'self_hosted' ? 'self_hosted' : 'cloud'
}
