export type View =
  | 'quickstart'
  | 'agents'
  | 'environments'
  | 'sessions'
  | 'providers'
  | 'vaults'
  | 'mcp'
  | 'usage'
  | 'audit'
  | 'settings'
export type LoadState = 'loading' | 'ready' | 'signed-out'
export type CreateMode = 'environment' | 'agent' | 'session' | 'provider' | 'vault' | null

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
  type: string
  displayName: string
  baseUrl: string
  credentialSecretRef: string
}

export interface VaultFormState {
  name: string
  description: string
  scope: 'project' | 'organization'
}
