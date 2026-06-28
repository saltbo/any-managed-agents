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
  name: string
  metadata: string
  volumes: string
  volumeMounts: string
}

export interface VaultFormState {
  name: string
  description: string
  scope: 'project' | 'organization'
}
