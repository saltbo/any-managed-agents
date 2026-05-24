import type { AgentFormState, EnvironmentFormState, ProviderFormState, SessionFormState, VaultFormState } from './types'

export const emptyEnvironment: EnvironmentFormState = {
  name: 'Node workspace',
  description: 'Default workspace for Pi-backed coding sessions.',
  packages: 'tsx@latest\ntypescript@latest',
  variables: 'NODE_ENV=development',
  runtimeImage: 'node:24',
}

export const emptyAgent: AgentFormState = {
  name: 'Coding agent',
  description: 'Executes development work in a managed sandbox.',
  instructions: 'You are a focused coding agent. Make changes, run checks, and report the result.',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  allowedTools: 'read\nwrite\nshell',
  mcpConnectors: '',
  sandboxPolicy: '{\n  "network": "enabled",\n  "filesystem": "workspace"\n}',
  metadata: '{}',
}

export const emptySession: SessionFormState = {
  agentId: '',
  environmentId: '',
  title: '',
  metadata: '{}',
  resourceRefs: '[]',
  vaultRefs: '[]',
}

export const emptyProvider: ProviderFormState = {
  type: 'workers-ai',
  displayName: 'Workers AI',
  baseUrl: '',
  credentialSecretRef: '',
}

export const emptyVault: VaultFormState = {
  name: 'Provider credentials',
  description: 'Credential references used by runtime sessions.',
  scope: 'project',
}
