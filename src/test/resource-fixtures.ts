import type {
  Agent,
  AgentSpec,
  AgentVersion,
  Environment,
  EnvironmentSpec,
  JsonObject,
  MemoryStore,
  MemoryStoreMemory,
  ResourceMetadata,
  Trigger,
  Vault,
  VaultCredential,
  VaultCredentialVersion,
} from '@/lib/amarpc'

const now = '2026-05-23T00:00:00.000Z'

export type ResourceMetadataOverrides = Partial<ResourceMetadata> & {
  id?: string
  name?: string
  description?: string | null
  archivedAt?: string | null
}

export function metadata(overrides: ResourceMetadataOverrides = {}): ResourceMetadata {
  return {
    uid: overrides.uid ?? overrides.id ?? 'resource_1',
    pid: overrides.pid === undefined ? 'project_1' : overrides.pid,
    name: overrides.name ?? 'Resource',
    description: overrides.description === undefined ? null : overrides.description,
    labels: overrides.labels ?? {},
    annotations: overrides.annotations ?? {},
    createdBy: overrides.createdBy === undefined ? 'user_1' : overrides.createdBy,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    archivedAt: overrides.archivedAt === undefined ? null : overrides.archivedAt,
  }
}

export type AgentOverrides = ResourceMetadataOverrides &
  Partial<AgentSpec> & {
    currentVersionId?: string | null
    version?: number
  }

export function agent(overrides: AgentOverrides = {}): Agent {
  return {
    metadata: metadata({
      id: 'agent_1',
      name: 'Coding agent',
      description: null,
      ...overrides,
    }),
    spec: {
      instructions: overrides.instructions === undefined ? 'Do the work' : overrides.instructions,
      providerId: overrides.providerId === undefined ? 'workers-ai' : overrides.providerId,
      model: overrides.model === undefined ? '@cf/moonshotai/kimi-k2.6' : overrides.model,
      skills: overrides.skills ?? ['ama@coding-agent'],
      subagents: overrides.subagents ?? [],
      role: overrides.role === undefined ? null : overrides.role,
      capabilityTags: overrides.capabilityTags ?? [],
      handoffPolicy: overrides.handoffPolicy ?? {},
      memoryPolicy: overrides.memoryPolicy ?? { enabled: false },
      tools: overrides.tools ?? [
        { name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
        { name: 'write', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
      ],
      mcpConnectors: overrides.mcpConnectors ?? [],
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
      currentVersionId: overrides.currentVersionId === undefined ? 'agentver_1' : overrides.currentVersionId,
      version: overrides.version ?? 1,
    },
  }
}

export type AgentVersionOverrides = ResourceMetadataOverrides &
  Partial<AgentSpec> & {
    agentId?: string
    version?: number
  }

export function agentVersion(overrides: AgentVersionOverrides = {}): AgentVersion {
  return {
    metadata: metadata({ id: 'agentver_1', name: 'Agent v1', ...overrides }),
    spec: agent(overrides).spec,
    status: {
      agentId: overrides.agentId ?? 'agent_1',
      version: overrides.version ?? 1,
    },
  }
}

export type EnvironmentOverrides = ResourceMetadataOverrides &
  Partial<EnvironmentSpec> & {
    currentVersionId?: string | null
    version?: number
  }

export function environment(overrides: EnvironmentOverrides = {}): Environment {
  return {
    metadata: metadata({
      id: 'env_1',
      name: 'Node workspace',
      description: null,
      ...overrides,
    }),
    spec: {
      packages: overrides.packages ?? [],
      variables: overrides.variables ?? {},
      hostingMode: overrides.hostingMode ?? 'cloud',
      networkPolicy: overrides.networkPolicy ?? { mode: 'restricted', allowedHosts: [] },
      mcpPolicy: overrides.mcpPolicy ?? {},
      packageManagerPolicy: overrides.packageManagerPolicy ?? {},
      resourceLimits: overrides.resourceLimits ?? { memoryMb: 1024 },
      runtimeConfig: overrides.runtimeConfig ?? { image: 'node:24' },
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
      currentVersionId: overrides.currentVersionId ?? 'envver_1',
      version: overrides.version ?? 1,
    },
  }
}

export type VaultOverrides = ResourceMetadataOverrides & {
  organizationId?: string
  scope?: 'project' | 'organization'
  metadata?: JsonObject
}

export function vault(overrides: VaultOverrides = {}): Vault {
  return {
    metadata: metadata({
      id: 'vault_1',
      name: 'Provider credentials',
      description: 'Model provider tokens',
      ...overrides,
    }),
    spec: {
      organizationId: overrides.organizationId ?? 'org_1',
      scope: overrides.scope ?? 'project',
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
    },
  }
}

export type VaultCredentialVersionOverrides = ResourceMetadataOverrides & {
  credentialId?: string
  vaultId?: string
  organizationId?: string
  version?: number
  provider?: 'ama'
  secretRef?: string
  referenceName?: string
  hasSecret?: boolean
  dataKeys?: string[]
  metadata?: JsonObject
  phase?: 'active' | 'superseded' | 'revoked'
  supersededAt?: string | null
  revokedAt?: string | null
}

export function vaultCredentialVersion(overrides: VaultCredentialVersionOverrides = {}): VaultCredentialVersion {
  return {
    metadata: metadata({ id: 'vaultver_1', name: 'Credential v1', ...overrides }),
    spec: {
      credentialId: overrides.credentialId ?? 'vaultcred_1',
      vaultId: overrides.vaultId ?? 'vault_1',
      organizationId: overrides.organizationId ?? 'org_1',
      version: overrides.version ?? 1,
      provider: overrides.provider ?? 'ama',
      secretRef: overrides.secretRef ?? 'ama-secret://vault_1/vaultcred_1',
      referenceName: overrides.referenceName ?? 'AMA_VAULTCRED_1_V1',
      hasSecret: overrides.hasSecret ?? true,
      dataKeys: overrides.dataKeys ?? ['value'],
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.phase ?? 'active',
      supersededAt: overrides.supersededAt ?? null,
      revokedAt: overrides.revokedAt ?? null,
    },
  }
}

export type VaultCredentialOverrides = ResourceMetadataOverrides & {
  vaultId?: string
  organizationId?: string
  type?: VaultCredential['spec']['type']
  metadata?: JsonObject
  phase?: 'active' | 'revoked'
  activeVersionId?: string | null
  activeVersion?: VaultCredentialVersion | null
  revokedAt?: string | null
  revokedByUserId?: string | null
  revokeReason?: string | null
}

export function credential(overrides: VaultCredentialOverrides = {}): VaultCredential {
  return {
    metadata: metadata({ id: 'vaultcred_1', name: 'OpenAI key', ...overrides }),
    spec: {
      vaultId: overrides.vaultId ?? 'vault_1',
      organizationId: overrides.organizationId ?? 'org_1',
      type: overrides.type ?? 'opaque',
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.phase ?? 'active',
      activeVersionId: overrides.activeVersionId ?? 'vaultver_1',
      activeVersion:
        overrides.activeVersion === undefined
          ? vaultCredentialVersion({ version: 2, credentialId: overrides.id ?? 'vaultcred_1' })
          : overrides.activeVersion,
      revokedAt: overrides.revokedAt ?? null,
      revokedByUserId: overrides.revokedByUserId ?? null,
      revokeReason: overrides.revokeReason ?? null,
    },
  }
}

export type MemoryStoreOverrides = ResourceMetadataOverrides & {
  metadata?: JsonObject
}

export function memoryStore(overrides: MemoryStoreOverrides = {}): MemoryStore {
  return {
    metadata: metadata({ id: 'store_1', name: 'Project memory', description: 'Reusable notes', ...overrides }),
    spec: {
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
    },
  }
}

export type MemoryOverrides = ResourceMetadataOverrides & {
  storeId?: string
  path?: string
  content?: string
  metadata?: JsonObject
}

export function memory(overrides: MemoryOverrides = {}): MemoryStoreMemory {
  return {
    metadata: metadata({ id: 'memory_1', name: overrides.path ?? 'guides/review.md', ...overrides }),
    spec: {
      storeId: overrides.storeId ?? 'store_1',
      path: overrides.path ?? 'guides/review.md',
      content: overrides.content ?? 'Review checklist',
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
    },
  }
}

export type TriggerOverrides = ResourceMetadataOverrides & {
  type?: Trigger['spec']['type']
  agentId?: string
  environmentId?: string | null
  runtime?: Trigger['spec']['runtime']
  promptTemplate?: string
  env?: Trigger['spec']['env']
  envFrom?: Trigger['spec']['envFrom']
  volumes?: Trigger['spec']['volumes']
  volumeMounts?: Trigger['spec']['volumeMounts']
  schedule?: Trigger['spec']['schedule']
  enabled?: boolean
  metadata?: JsonObject
  nextDueAt?: string | null
  lastDispatchedAt?: string | null
  lastRunId?: string | null
}

export function trigger(overrides: TriggerOverrides = {}): Trigger {
  return {
    metadata: metadata({ id: 'trigger_1', name: 'Daily research heartbeat', ...overrides }),
    spec: {
      type: overrides.type ?? 'scheduled',
      agentId: overrides.agentId ?? 'agent_1',
      environmentId: overrides.environmentId === undefined ? 'env_1' : overrides.environmentId,
      runtime: overrides.runtime ?? 'codex',
      promptTemplate: overrides.promptTemplate ?? 'Research current offers.',
      env: overrides.env ?? {},
      envFrom: overrides.envFrom ?? [],
      volumes: overrides.volumes ?? [],
      volumeMounts: overrides.volumeMounts ?? [],
      schedule:
        overrides.schedule === undefined
          ? { type: 'interval', intervalSeconds: 86400, windowSeconds: 0 }
          : overrides.schedule,
      enabled: overrides.enabled ?? true,
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
      nextDueAt: overrides.nextDueAt === undefined ? '2026-06-19T12:00:00.000Z' : overrides.nextDueAt,
      lastDispatchedAt:
        overrides.lastDispatchedAt === undefined ? '2026-06-18T12:00:00.000Z' : overrides.lastDispatchedAt,
      lastRunId: overrides.lastRunId === undefined ? 'trigrun_1' : overrides.lastRunId,
    },
  }
}
