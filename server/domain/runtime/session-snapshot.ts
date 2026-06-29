import type { AgentVersionRow, EnvironmentVersionRow } from '@shared/runtime-rows'
import type { AgentHandoff } from '../agent'
import { defaultEnvironmentPackages, type EnvironmentNetworking, type EnvironmentPackages } from '../environment'
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeHandoff(value: unknown, capabilityTags: string[]): AgentHandoff {
  const handoff = objectValue(value)
  const accepts = objectValue(handoff.accepts)
  const capabilities = stringArray(accepts.capabilities)
  return {
    enabled: handoff.enabled === true,
    accepts: {
      roles: stringArray(accepts.roles),
      capabilities: capabilities.length > 0 ? capabilities : capabilityTags,
    },
    targets: Array.isArray(handoff.targets)
      ? handoff.targets
          .filter((target): target is Record<string, unknown> => Boolean(target) && typeof target === 'object')
          .map((target) => ({
            ...(typeof target.role === 'string' && target.role ? { role: target.role } : {}),
            ...(typeof target.capability === 'string' && target.capability ? { capability: target.capability } : {}),
          }))
          .filter((target) => target.role !== undefined || target.capability !== undefined)
      : [],
  }
}

export function createAgentSnapshot(row: AgentVersionRow, providerId: string) {
  const capabilityTags = JSON.parse(row.capabilityTags) as string[]
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    systemPrompt: row.instructions,
    provider: providerId,
    model: row.model,
    skills: JSON.parse(row.skills) as string[],
    subagents: JSON.parse(row.subagents) as Record<string, unknown>[],
    role: row.role,
    handoff: normalizeHandoff(JSON.parse(row.handoffPolicy) as Record<string, unknown>, capabilityTags),
    tools: JSON.parse(row.tools) as Record<string, unknown>[],
    mcpConnectors: JSON.parse(row.mcpConnectors) as string[],
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
  const systemPrompt = agentSnapshot.systemPrompt?.trim()
  return {
    ...agentSnapshot,
    systemPrompt: systemPrompt ? `${systemPrompt}\n\n${block}` : block,
  }
}

function normalizePackages(value: unknown): EnvironmentPackages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultEnvironmentPackages()
  }
  const packages = value as Record<string, unknown>
  return {
    ...defaultEnvironmentPackages(),
    type: 'packages',
    apt: stringArray(packages.apt),
    cargo: stringArray(packages.cargo),
    gem: stringArray(packages.gem),
    go: stringArray(packages.go),
    npm: stringArray(packages.npm),
    pip: stringArray(packages.pip),
  }
}

function networkingFromRow(row: EnvironmentVersionRow): EnvironmentNetworking {
  const policy = JSON.parse(row.networkPolicy) as Record<string, unknown>
  return {
    type: policy.mode === 'offline' ? 'closed' : policy.mode === 'restricted' ? 'limited' : 'open',
    allowMcpServers: policy.allowMcpServers === true,
    allowPackageManagers: policy.allowPackageManagers !== false,
    ...(Array.isArray(policy.allowedHosts) ? { allowedHosts: stringArray(policy.allowedHosts) } : {}),
  }
}

export function createEnvironmentSnapshot(row: EnvironmentVersionRow) {
  const metadata = JSON.parse(row.metadata) as Record<string, unknown>
  return {
    id: row.id,
    environmentId: row.environmentId,
    projectId: row.projectId,
    version: row.version,
    scope: metadata.scope === 'organization' ? ('organization' as const) : ('project' as const),
    type: row.hostingMode === 'self_hosted' ? ('self_hosted' as const) : ('cloud' as const),
    networking: networkingFromRow(row),
    packages: normalizePackages(JSON.parse(row.packages) as unknown),
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    createdAt: row.createdAt,
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
    type: snapshotRecord.type === 'self_hosted' ? 'self_hosted' : 'cloud',
    networking: objectValue(snapshotRecord.networking),
  } as unknown as EnvironmentSnapshot
}
