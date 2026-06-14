import type { AgentVersionRow, EnvironmentVersionRow } from '../adapters/repos/runtime-orchestration'
import { hasEmbeddedCredentialUrl, normalizeMountPath } from '../domain/session'

// Snapshot serialization (DB row → immutable session snapshot) and resource-ref
// normalization for the session runtime data plane. Pure shaping/validation with
// no env or D1 dependency, factored out of the orchestration module.

export function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

export function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export type ResourceRef = Record<string, unknown>
export type GitHubRepositoryResourceRef = {
  type: 'github_repository'
  owner: string
  repo: string
  ref?: string
  mountPath?: string
  credentialRef?: { credentialId: string; versionId?: string }
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

export function normalizeResourceRefs(resourceRefs: ResourceRef[]) {
  const normalized: ResourceRef[] = []
  const mountPaths = new Set<string>()
  for (const [index, resourceRef] of resourceRefs.entries()) {
    if (hasEmbeddedCredentialUrl(resourceRef)) {
      return { fields: { [`resourceRefs.${index}`]: 'URLs with embedded credentials are not allowed.' } }
    }
    if (resourceRef.type !== 'github_repository') {
      normalized.push(resourceRef)
      continue
    }
    const parsed = resourceRef as GitHubRepositoryResourceRef
    let mountPath: string
    try {
      mountPath = normalizeMountPath(parsed)
    } catch (error) {
      return { fields: { [`resourceRefs.${index}.mountPath`]: error instanceof Error ? error.message : String(error) } }
    }
    if (mountPaths.has(mountPath)) {
      return { fields: { [`resourceRefs.${index}.mountPath`]: 'Mount path must be unique within a session.' } }
    }
    mountPaths.add(mountPath)
    normalized.push({
      type: 'github_repository',
      owner: parsed.owner,
      repo: parsed.repo,
      mountPath,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...(parsed.credentialRef ? { credentialRef: parsed.credentialRef } : {}),
    })
  }
  return { resourceRefs: normalized }
}
