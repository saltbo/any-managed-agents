import type { AgentVersionRow, EnvironmentVersionRow } from '@shared/runtime-rows'
import { isMemoryStoreAccess, memoryStoreMountPath } from '../memory-store'
import {
  isGitHubRepositoryVolume,
  isMemoryStoreVolume,
  type GitHubRepositoryVolume,
  type MemoryStoreVolume,
  type Volume,
  type VolumeMount,
  volumeMountPath,
} from './execution-inputs'

// Snapshot serialization (DB row -> immutable session snapshot) and volume
// normalization for the session runtime data plane. Pure shaping/validation with
// no env or D1 dependency, factored out of the orchestration module.

export function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

export function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function serializeAgentVersion(row: AgentVersionRow, providerId: string) {
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

export type SerializedAgentVersion = ReturnType<typeof serializeAgentVersion>

export function parseAgentSnapshot(value: string | null) {
  return parseJson<SerializedAgentVersion>(value)
}

export function agentSnapshotWithWorkspaceContext(
  agentSnapshot: SerializedAgentVersion,
  volumes: Volume[],
  volumeMounts: VolumeMount[],
): SerializedAgentVersion {
  const block = workspaceSystemPromptBlock(volumes, volumeMounts)
  if (!block) {
    return agentSnapshot
  }
  const instructions = agentSnapshot.instructions?.trim()
  return {
    ...agentSnapshot,
    instructions: instructions ? `${instructions}\n\n${block}` : block,
  }
}

function workspaceSystemPromptBlock(volumes: Volume[], volumeMounts: VolumeMount[]): string | null {
  const repositories = volumes
    .filter(isGitHubRepositoryVolume)
    .map((volume) => {
      const owner = String(volume.owner ?? '')
      const repo = String(volume.repo ?? '')
      const mountPath = relativeWorkspacePath(volumeMountPath(volume.name, volumeMounts) ?? `/workspace/repos/${owner}/${repo}`)
      return `- ${owner}/${repo} at ${mountPath}`
    })
  const memoryStores = volumes
    .filter(isMemoryStoreVolume)
    .map((volume) => {
      const storeId = String(volume.storeId ?? '')
      const access = volume.access === 'read_write' ? 'read_write' : 'read_only'
      const mountPath = relativeWorkspacePath(volumeMountPath(volume.name, volumeMounts) ?? memoryStoreMountPath(storeId))
      const description =
        typeof volume.description === 'string' && volume.description.trim()
          ? `\n  Description: ${volume.description.trim()}`
          : ''
      return `- ${volume.storeName || volume.name || storeId} (${access}) at ${mountPath}${description}`
    })
  if (repositories.length === 0 && memoryStores.length === 0) {
    return null
  }
  const lines = ['Workspace layout:', '- The current working directory is this session workspace root.']
  if (repositories.length > 0) {
    lines.push('- Repositories:', ...repositories.map((repository) => `  ${repository}`))
  }
  if (memoryStores.length > 0) {
    lines.push('- Memory stores:', ...memoryStores.map((store) => `  ${store}`))
  }
  return lines.join('\n')
}

function relativeWorkspacePath(path: string): string {
  if (path === '/workspace') {
    return '.'
  }
  if (path.startsWith('/workspace/')) {
    return path.slice('/workspace/'.length)
  }
  return path
}

export function serializeEnvironmentVersion(row: EnvironmentVersionRow) {
  return {
    ...row,
    packages: JSON.parse(row.packages) as Record<string, unknown>[],
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    credentialRefs: JSON.parse(row.credentialRefs) as Record<string, unknown>[],
    hostingMode: row.hostingMode,
    networkPolicy: JSON.parse(row.networkPolicy) as Record<string, unknown>,
    mcpPolicy: JSON.parse(row.mcpPolicy) as Record<string, unknown>,
    packageManagerPolicy: JSON.parse(row.packageManagerPolicy) as Record<string, unknown>,
    resourceLimits: JSON.parse(row.resourceLimits) as Record<string, unknown>,
    runtimeConfig: JSON.parse(row.runtimeConfig) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  }
}

export type NormalizedEnvironmentSnapshot = ReturnType<typeof serializeEnvironmentVersion>

export function normalizeEnvironmentSnapshot(
  snapshot: ReturnType<typeof serializeEnvironmentVersion> | Record<string, unknown> | null,
): NormalizedEnvironmentSnapshot | null {
  if (!snapshot) {
    return null
  }
  const snapshotRecord = snapshot as Record<string, unknown>
  return {
    ...snapshotRecord,
    hostingMode: snapshotRecord.hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud',
    networkPolicy: objectValue(snapshotRecord.networkPolicy),
    runtimeConfig: objectValue(snapshotRecord.runtimeConfig),
  } as NormalizedEnvironmentSnapshot
}

export function normalizeWorkspaceVolumes(volumes: Volume[], volumeMounts: VolumeMount[]) {
  const normalizedVolumes: Volume[] = []
  const normalizedMounts: VolumeMount[] = []
  const mountPaths = new Set<string>()
  const volumeNames = new Set<string>()
  for (const [index, mount] of volumeMounts.entries()) {
    const normalizedPath = normalizeWorkspaceMountPath(mount.mountPath)
    if (!normalizedPath) {
      return { fields: { [`volumeMounts.${index}.mountPath`]: 'Volume mount path must stay under /workspace.' } }
    }
    normalizedMounts.push({ ...mount, mountPath: normalizedPath })
  }
  for (const [index, volume] of volumes.entries()) {
    if (volumeNames.has(volume.name)) {
      return { fields: { [`volumes.${index}.name`]: 'Volume names must be unique.' } }
    }
    volumeNames.add(volume.name)
    if (!isGitHubRepositoryVolume(volume)) {
      if (!isMemoryStoreVolume(volume)) {
        normalizedVolumes.push(volume)
        continue
      }
      const parsed = volume
      if (typeof parsed.storeId !== 'string' || parsed.storeId.trim().length === 0) {
        return { fields: { [`volumes.${index}.storeId`]: 'Memory store id is required.' } }
      }
      if (!isMemoryStoreAccess(parsed.access)) {
        return { fields: { [`volumes.${index}.access`]: 'Use read_only or read_write.' } }
      }
      const mountIndex = normalizedMounts.findIndex((mount) => mount.name === parsed.name)
      if (mountIndex === -1) {
        return { fields: { [`volumes.${index}.name`]: 'Memory store volume must have a matching volume mount.' } }
      }
      const mountPath = normalizedMounts[mountIndex]!.mountPath
      if (!mountPath.startsWith('/workspace/.ama/memory-stores/')) {
        return { fields: { [`volumeMounts.${mountIndex}.mountPath`]: 'Memory store mounts must stay under /workspace/.ama/memory-stores.' } }
      }
      if (mountPaths.has(mountPath)) {
        return { fields: { [`volumeMounts.${mountIndex}.mountPath`]: 'Mount path must be unique within a session.' } }
      }
      mountPaths.add(mountPath)
      normalizedVolumes.push({
        name: parsed.name,
        type: 'memory_store',
        storeId: parsed.storeId,
        access: parsed.access,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.memories ? { memories: parsed.memories } : {}),
      })
      continue
    }
    const parsed = volume
    const mountIndex = normalizedMounts.findIndex((mount) => mount.name === parsed.name)
    if (mountIndex === -1) {
      return { fields: { [`volumes.${index}.name`]: 'Repository volume must have a matching volume mount.' } }
    }
    const mountPath = normalizedMounts[mountIndex]!.mountPath
    if (!mountPath.startsWith('/workspace/') || mountPath.startsWith('/workspace/.ama/')) {
      return { fields: { [`volumeMounts.${mountIndex}.mountPath`]: 'Repository mount path must stay under /workspace outside /workspace/.ama.' } }
    }
    if (mountPaths.has(mountPath)) {
      return { fields: { [`volumeMounts.${mountIndex}.mountPath`]: 'Mount path must be unique within a session.' } }
    }
    mountPaths.add(mountPath)
    normalizedVolumes.push({
      name: parsed.name,
      type: 'github_repository',
      owner: parsed.owner,
      repo: parsed.repo,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...(parsed.credentialRef ? { credentialRef: parsed.credentialRef } : {}),
    })
  }
  return { volumes: normalizedVolumes, volumeMounts: normalizedMounts }
}

function normalizeWorkspaceMountPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || /[\p{C}\\]/u.test(trimmed)) {
    return null
  }
  const absolute = trimmed.startsWith('/') ? trimmed : `/workspace/${trimmed}`
  if (!absolute.startsWith('/workspace/')) {
    return null
  }
  const relativePath = absolute.slice('/workspace/'.length)
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null
  }
  return `/workspace/${segments.join('/')}`
}
