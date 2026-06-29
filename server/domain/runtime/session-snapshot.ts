import type { AgentVersionRow, EnvironmentVersionRow } from '@shared/runtime-rows'
import { workspaceSystemPromptBlock } from '../workspace'
import type { Volume, VolumeMount } from './execution-inputs'

// Snapshot creation (DB row -> immutable session snapshot) and volume
// normalization for the session runtime data plane. Pure shaping/validation with
// no env or D1 dependency, factored out of the orchestration module.

export function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

export function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function createAgentSnapshot(row: AgentVersionRow, providerId: string) {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    instructions: row.instructions,
    providerId,
    model: row.model,
    skills: JSON.parse(row.skills) as string[],
    subagents: JSON.parse(row.subagents) as Record<string, unknown>[],
    role: row.role,
    capabilityTags: JSON.parse(row.capabilityTags) as string[],
    handoffPolicy: JSON.parse(row.handoffPolicy) as Record<string, unknown>,
    memoryPolicy: JSON.parse(row.memoryPolicy) as Record<string, unknown>,
    tools: JSON.parse(row.tools) as Record<string, unknown>[],
    mcpConnectors: JSON.parse(row.mcpConnectors) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

export type AgentSnapshot = ReturnType<typeof createAgentSnapshot>

export function parseAgentSnapshot(value: string | null) {
  return parseJson<AgentSnapshot>(value)
}

export function agentSnapshotWithWorkspaceContext(
  agentSnapshot: AgentSnapshot,
  volumes: Volume[],
  volumeMounts: VolumeMount[],
): AgentSnapshot {
  const block = workspaceSystemPromptBlock({ volumes, volumeMounts })
  if (!block) {
    return agentSnapshot
  }
  const instructions = agentSnapshot.instructions?.trim()
  return {
    ...agentSnapshot,
    instructions: instructions ? `${instructions}\n\n${block}` : block,
  }
}

export function createEnvironmentSnapshot(row: EnvironmentVersionRow) {
  return {
    ...row,
    packages: JSON.parse(row.packages) as Record<string, unknown>[],
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    hostingMode: row.hostingMode,
    networkPolicy: JSON.parse(row.networkPolicy) as Record<string, unknown>,
    mcpPolicy: JSON.parse(row.mcpPolicy) as Record<string, unknown>,
    packageManagerPolicy: JSON.parse(row.packageManagerPolicy) as Record<string, unknown>,
    resourceLimits: JSON.parse(row.resourceLimits) as Record<string, unknown>,
    runtimeConfig: JSON.parse(row.runtimeConfig) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  }
}

export type EnvironmentSnapshot = ReturnType<typeof createEnvironmentSnapshot>

export function normalizeEnvironmentSnapshot(
  snapshot: ReturnType<typeof createEnvironmentSnapshot> | Record<string, unknown> | null,
): EnvironmentSnapshot | null {
  if (!snapshot) {
    return null
  }
  const snapshotRecord = snapshot as Record<string, unknown>
  return {
    ...snapshotRecord,
    hostingMode: snapshotRecord.hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud',
    networkPolicy: objectValue(snapshotRecord.networkPolicy),
    runtimeConfig: objectValue(snapshotRecord.runtimeConfig),
  } as EnvironmentSnapshot
}
