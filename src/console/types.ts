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
export type CreateMode = 'environment' | 'agent' | 'provider' | 'vault' | null

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
  allowedTools: string
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
