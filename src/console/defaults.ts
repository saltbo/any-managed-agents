import type { AgentFormState, EnvironmentFormState } from './types'

export const emptyEnvironment: EnvironmentFormState = {
  name: 'Node workspace',
  description: 'Default workspace for Pi-backed coding sessions.',
  packages: 'tsx@latest\ntypescript@latest',
  variables: 'NODE_ENV=development',
  runtimeImage: 'node:24',
}

export const emptyAgent: AgentFormState = {
  name: 'Coding agent',
  description: 'Executes development tasks in a managed sandbox.',
  instructions: 'You are a focused coding agent. Make changes, run checks, and report the result.',
  allowedTools: 'read\nwrite\nshell',
}
