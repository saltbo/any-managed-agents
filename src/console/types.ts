import type { ProviderInputType } from '@/lib/api'

export interface EnvironmentFormState {
  name: string
  description: string
  packages: string
  variables: string
  runtimeImage: string
}

export interface AgentFormState {
  name: string
  description: string
  instructions: string
  provider: string
  model: string
  allowedTools: string
  mcpConnectors: string
  sandboxPolicy: string
  metadata: string
}

export interface SessionFormState {
  agentId: string
  environmentId: string
  title: string
  metadata: string
  resourceRefs: string
  vaultRefs: string
}

export interface ProviderFormState {
  type: ProviderInputType
  displayName: string
  baseUrl: string
  credentialSecretRef: string
}

export interface VaultFormState {
  name: string
  description: string
  scope: 'project' | 'organization'
}
