import type { Agent, AgentInput, Environment, EnvironmentInput, Provider, Session } from '@/lib/api'

export const QUICKSTART_STEPS = ['provider', 'environment', 'agent', 'session', 'integration'] as const
export type QuickstartStep = (typeof QUICKSTART_STEPS)[number]

export const QUICKSTART_STEP_TITLES: Record<QuickstartStep, string> = {
  provider: 'Provider',
  environment: 'Environment',
  agent: 'Agent',
  session: 'Session',
  integration: 'Integration',
}

export const QUICKSTART_STEP_CALLS: Record<QuickstartStep, string> = {
  provider: 'GET /api/providers',
  environment: 'POST /api/environments',
  agent: 'POST /api/agents',
  session: 'POST /api/sessions',
  integration: 'GET /api/openapi.json',
}

// Keep this prompt free of runtime trigger words such as "command", "status",
// or "inspect": it must stay a safe, read-only first task in every runtime.
export const SAFE_EXAMPLE_PROMPT =
  'Introduce yourself and confirm this session is ready. Stay read-only and do not modify the workspace.'

export interface QuickstartResources {
  providers: Provider[]
  environments: Environment[]
  agents: Agent[]
  sessions: Session[]
}

export type QuickstartCompletion = Record<QuickstartStep, boolean>

export function quickstartCompletion(resources: QuickstartResources): QuickstartCompletion {
  return {
    provider: resources.providers.some((provider) => provider.status === 'active'),
    environment: resources.environments.some((environment) => environment.status === 'active'),
    agent: resources.agents.some((agent) => agent.status === 'active'),
    session: resources.sessions.length > 0,
    integration: resources.sessions.some((session) => session.runtimeEndpointPath !== null),
  }
}

export function firstIncompleteStep(completion: QuickstartCompletion): QuickstartStep {
  return QUICKSTART_STEPS.find((step) => !completion[step]) ?? 'integration'
}

// Completed steps stay revisitable; the only reachable incomplete step is the
// next one in sequence, so the guided flow cannot skip prerequisites.
export function isStepUnlocked(step: QuickstartStep, completion: QuickstartCompletion) {
  return completion[step] || step === firstIncompleteStep(completion)
}

export function resolveQuickstartStep(requested: string | null, completion: QuickstartCompletion): QuickstartStep {
  const candidate = QUICKSTART_STEPS.find((step) => step === requested)
  if (candidate && isStepUnlocked(candidate, completion)) {
    return candidate
  }
  return firstIncompleteStep(completion)
}

// ─── Environment step ───

export interface QuickstartEnvironmentForm {
  name: string
  networkChoice: 'unrestricted' | 'restricted'
  allowedHosts: string
  mcpAccess: boolean
  packageManagerAccess: boolean
}

export const defaultQuickstartEnvironmentForm: QuickstartEnvironmentForm = {
  name: 'Quickstart environment',
  networkChoice: 'unrestricted',
  allowedHosts: 'registry.npmjs.org',
  mcpAccess: true,
  packageManagerAccess: true,
}

export function quickstartEnvironmentInput(form: QuickstartEnvironmentForm): EnvironmentInput {
  const base: EnvironmentInput = {
    name: form.name.trim(),
    description: 'Reusable sandbox template created in quickstart.',
    hostingMode: 'cloud',
    runtimeConfig: { image: 'ama-pi-runtime' },
  }
  if (form.networkChoice === 'unrestricted') {
    return { ...base, networkPolicy: { mode: 'unrestricted' } }
  }
  return {
    ...base,
    networkPolicy: {
      mode: 'restricted',
      allowedHosts: form.allowedHosts
        .split(/\r?\n/)
        .map((host) => host.trim())
        .filter(Boolean),
    },
    mcpPolicy: form.mcpAccess ? { allowedConnectors: ['*'] } : { blockedConnectors: ['*'] },
    packageManagerPolicy: form.packageManagerAccess
      ? { allowedRegistries: ['registry.npmjs.org'] }
      : { allowedRegistries: [] },
  }
}

// ─── Sandbox add-on ───

export const SANDBOX_TOOLS = ['sandbox.exec', 'sandbox.read', 'sandbox.write'] as const
export const DEFAULT_SANDBOX_SKILL = 'ama@coding-agent'

export function agentHasSandboxExecution(agent: Agent) {
  return (
    agent.allowedTools.length === 0 || agent.allowedTools.includes('*') || agent.allowedTools.includes('sandbox.exec')
  )
}

export function sandboxAgentInput(agent: Agent): Partial<AgentInput> {
  return {
    allowedTools: [...new Set([...agent.allowedTools, ...SANDBOX_TOOLS])],
    skills: agent.skills.length > 0 ? agent.skills : [DEFAULT_SANDBOX_SKILL],
  }
}

// ─── Integration step ───

export interface QuickstartIntegrationInput {
  origin: string
  agentId: string
  environmentId: string | null
  sessionId: string
  runtimeEndpointPath: string | null
}

export function quickstartIntegrationExamples(input: QuickstartIntegrationInput) {
  const authHeader = '-H "Authorization: Bearer $AMA_ACCESS_TOKEN"'
  const sessionBody = JSON.stringify({
    agentId: input.agentId,
    environmentId: input.environmentId,
    runtime: 'ama',
    initialPrompt: SAFE_EXAMPLE_PROMPT,
  })
  const liveSessionUrl = input.runtimeEndpointPath
    ? `${input.origin}${input.runtimeEndpointPath}`
    : `${input.origin}/api/sessions/${input.sessionId}/events/stream`
  const curl = [
    `curl -X POST "${input.origin}/api/sessions" \\`,
    `  ${authHeader} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '${sessionBody}'`,
    `curl "${input.origin}/api/sessions/${input.sessionId}/events" ${authHeader}`,
    `curl "${liveSessionUrl}" ${authHeader}`,
  ].join('\n')
  const restish = [
    `restish ${input.origin}/api/openapi.json`,
    `printf '%s\\n' '${sessionBody}' | restish post ${input.origin}/api/sessions ${authHeader}`,
    `restish get ${input.origin}/api/sessions/${input.sessionId} ${authHeader}`,
  ].join('\n')
  const sdk = [
    "import { AmaClient } from '@any-managed-agents/sdk'",
    '',
    'const client = new AmaClient({',
    `  origin: '${input.origin}',`,
    '  accessToken: process.env.AMA_ACCESS_TOKEN ?? "",',
    '})',
    `const session = await client.request('readSession', { path: { sessionId: '${input.sessionId}' } })`,
    `const events = await client.request('listSessionEvents', { path: { sessionId: '${input.sessionId}' } })`,
  ].join('\n')
  return { curl, restish, sdk }
}
