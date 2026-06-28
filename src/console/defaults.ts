import type { AgentFormState, EnvironmentFormState, SessionFormState, VaultFormState } from './types'

export const emptyEnvironment: EnvironmentFormState = {
  name: 'Node workspace',
  description: 'Default workspace for Pi-backed coding sessions.',
  hostingMode: 'cloud',
  networkMode: 'restricted',
  allowedHosts: 'registry.npmjs.org',
  packages: 'tsx@latest\ntypescript@latest',
  variables: 'NODE_ENV=development',
  runtimeConfig: '{\n  "image": "node:24"\n}',
}

export const emptyAgent: AgentFormState = {
  name: 'Coding agent',
  description: 'Executes development work in a managed sandbox.',
  instructions: 'You are a focused coding agent. Make changes, run checks, and report the result.',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  skills: 'ama@coding-agent',
  allowedTools: 'read\nwrite\nshell',
  mcpConnectors: '',
  metadata: '{}',
}

export const emptySession: SessionFormState = {
  agentId: '',
  environmentId: '',
  runtime: 'ama',
  name: '',
  metadata: '{}',
  volumes: '[]',
  volumeMounts: '[]',
}

export const emptyVault: VaultFormState = {
  name: 'Provider credentials',
  description: 'Credential references used by runtime sessions.',
  scope: 'project',
}
