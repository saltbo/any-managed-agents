// Pure environment business rules. Zero outward imports — directly
// unit-testable. Network-policy shape parsing lives in the openapi/contract
// schema (zod) and the repo; the domain only owns secret-material rules and the
// version-snapshot decision.

import type { ResourceMetadata, ResourcePhase } from './resource'

export type EnvironmentHostingMode = 'cloud' | 'self_hosted'

// Optional fields explicitly admit `undefined` so a zod-inferred request body
// (which carries `T | undefined` under exactOptionalPropertyTypes) is accepted.
export interface EnvironmentNetworkPolicy {
  mode: 'offline' | 'restricted' | 'unrestricted'
  allowedHosts?: string[] | undefined
}

export interface EnvironmentPackage {
  name: string
  version?: string | undefined
}

export interface EnvironmentVariable {
  description?: string | undefined
  required?: boolean | undefined
}

// The runtime-relevant configuration that an environment version snapshots.
export interface EnvironmentConfig {
  packages: EnvironmentPackage[]
  variables: Record<string, EnvironmentVariable>
  hostingMode: EnvironmentHostingMode
  networkPolicy: EnvironmentNetworkPolicy
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  resourceLimits: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface Environment {
  metadata: ResourceMetadata
  spec: EnvironmentConfig
  status: EnvironmentStatus
}

export interface EnvironmentStatus {
  phase: ResourcePhase
  currentVersionId: string | null
  version: number
}

export interface EnvironmentVersion {
  metadata: ResourceMetadata
  spec: EnvironmentConfig
  status: EnvironmentVersionStatus
}

export interface EnvironmentVersionStatus {
  environmentId: string
  version: number
}

// The config fields whose presence in a PATCH body forces a new version
// snapshot. (name/description are not runtime config — they never version.)
export const RUNTIME_CONFIG_FIELDS = [
  'packages',
  'variables',
  'hostingMode',
  'networkPolicy',
  'mcpPolicy',
  'packageManagerPolicy',
  'resourceLimits',
  'runtimeConfig',
  'metadata',
] as const

// Validation failures are keyed by the field that caused them; the http layer
// maps a non-null result to a 400 validation error envelope.
export type FieldErrors = Record<string, string>

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => {
    return secretKey(key) || hasSecretMaterial(child)
  })
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

// The free-form JSON config fields that must never carry raw secret material —
// secrets belong in a vault secret reference, not inline configuration.
export function validateSecretFreeObjects(values: {
  metadata: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
}): FieldErrors | null {
  if (hasSecretMaterial(values.metadata)) {
    return { metadata: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(values.mcpPolicy)) {
    return { mcpPolicy: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(values.packageManagerPolicy)) {
    return { packageManagerPolicy: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(values.runtimeConfig)) {
    return { runtimeConfig: 'Secret material must be stored in a vault.' }
  }
  return null
}

// The MCP connector ids referenced (positively or negatively) by an mcp policy.
// '*' is a wildcard and never resolves to a concrete connection.
export function mcpPolicyConnectorIds(mcpPolicy: Record<string, unknown>): string[] {
  const approvalModes = mcpPolicy.connectorApprovalModes
  const ids = [
    ...stringArray(mcpPolicy.allowedConnectors),
    ...stringArray(mcpPolicy.blockedConnectors),
    ...stringArray(mcpPolicy.requireApprovalConnectors),
    ...(approvalModes && typeof approvalModes === 'object' && !Array.isArray(approvalModes)
      ? Object.keys(approvalModes)
      : []),
  ]
  return [...new Set(ids)].filter((id) => id !== '*')
}
