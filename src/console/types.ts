export interface EnvironmentFormState {
  name: string
  description: string
  type: 'cloud' | 'self_hosted'
  networkingType: 'open' | 'limited' | 'closed'
  allowMcpServers: boolean
  allowPackageManagers: boolean
  allowedHosts: string
  packages: string
  variables: string
}

export interface AgentFormState {
  name: string
  description: string
  systemPrompt: string
  provider: string
  model: string
  skills: string
  allowedTools: string
  mcpConnectors: string
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
