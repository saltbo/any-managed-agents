export type View = 'agents' | 'environments' | 'sessions'
export type LoadState = 'loading' | 'ready' | 'signed-out'
export type CreateMode = 'environment' | 'agent' | null

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
