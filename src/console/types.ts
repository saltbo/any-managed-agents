import type { ProviderInputType } from '@/lib/api'

export interface EnvironmentFormState {
  name: string
  description: string
  hostingMode: 'cloud' | 'self_hosted'
  networkMode: 'unrestricted' | 'restricted' | 'offline'
  allowedHosts: string
  packages: string
  variables: string
  runtimeConfig: string
}

export interface AgentFormState {
  name: string
  description: string
  instructions: string
  provider: string
  model: string
  skills: string
  allowedTools: string
  mcpConnectors: string
  metadata: string
}

export interface SessionFormState {
  agentId: string
  environmentId: string
  runtime: 'ama' | 'claude-code' | 'codex' | 'copilot'
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
