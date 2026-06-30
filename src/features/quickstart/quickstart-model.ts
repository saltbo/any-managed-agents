import { AMA_SANDBOX_TOOL_NAMES } from '@ama/runtime-contracts/agent-tools'
import { isArchived } from '@/console/format'
import type { Agent, AgentInput, Environment, EnvironmentInput, Provider, Session } from '@/lib/amarpc'

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
  provider: 'GET /api/v1/providers',
  environment: 'POST /api/v1/environments',
  agent: 'POST /api/v1/agents',
  session: 'POST /api/v1/sessions',
  integration: 'GET /api/v1/openapi.json',
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
    provider: resources.providers.some((provider) => provider.enabled),
    environment: resources.environments.some((environment) => !isArchived(environment)),
    agent: resources.agents.some((agent) => !isArchived(agent)),
    session: resources.sessions.length > 0,
    integration: resources.sessions.some(
      (session) => session.status.phase === 'idle' || session.status.phase === 'running',
    ),
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
    type: 'cloud',
    packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] },
  }
  if (form.networkChoice === 'unrestricted') {
    return {
      ...base,
      networking: {
        type: 'open',
        allowMcpServers: form.mcpAccess,
        allowPackageManagers: form.packageManagerAccess,
      },
    }
  }
  return {
    ...base,
    networking: {
      type: 'limited',
      allowMcpServers: form.mcpAccess,
      allowPackageManagers: form.packageManagerAccess,
      allowedHosts: form.allowedHosts
        .split(/\r?\n/)
        .map((host) => host.trim())
        .filter(Boolean),
    },
  }
}

// ─── Sandbox add-on ───

export const SANDBOX_TOOLS = AMA_SANDBOX_TOOL_NAMES
export const DEFAULT_SANDBOX_SKILL = 'ama@coding-agent'

export function agentHasSandboxExecution(agent: Agent) {
  const names = agent.spec.tools.map((tool) => tool.name)
  return names.length === 0 || names.includes('*') || names.includes('bash')
}

export function sandboxAgentInput(agent: Agent): Partial<AgentInput> {
  const existing = agent.spec.tools.map((tool) => tool.name)
  const merged = [...new Set([...existing, ...SANDBOX_TOOLS])]
  return {
    tools: merged.map((name) => ({ name })),
    skills: agent.spec.skills.length > 0 ? agent.spec.skills : [DEFAULT_SANDBOX_SKILL],
  }
}

// ─── Integration step ───

export interface QuickstartIntegrationInput {
  origin: string
  agentId: string
  environmentId: string | null
  sessionId: string
  runtimePath: string | null
}

export function quickstartIntegrationExamples(input: QuickstartIntegrationInput) {
  const authHeader = '-H "Authorization: Bearer $AMA_ACCESS_TOKEN"'
  const sessionBody = JSON.stringify({
    agentId: input.agentId,
    environmentId: input.environmentId,
    runtime: 'ama',
    prompt: SAFE_EXAMPLE_PROMPT,
  })
  const liveSessionUrl = input.runtimePath
    ? `${input.origin}${input.runtimePath}`
    : `${input.origin}/api/v1/sessions/${input.sessionId}/events`
  const curl = [
    `curl -X POST "${input.origin}/api/v1/sessions" \\`,
    `  ${authHeader} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '${sessionBody}'`,
    `curl "${input.origin}/api/v1/sessions/${input.sessionId}/events" ${authHeader}`,
    `curl "${liveSessionUrl}" ${authHeader}`,
  ].join('\n')
  const restish = [
    `restish ${input.origin}/api/v1/openapi.json`,
    `printf '%s\\n' '${sessionBody}' | restish post ${input.origin}/api/v1/sessions ${authHeader}`,
    `restish get ${input.origin}/api/v1/sessions/${input.sessionId} ${authHeader}`,
  ].join('\n')
  const sdk = [
    "import { createAmaClient } from '@any-managed-agents/sdk'",
    '',
    'const client = createAmaClient({',
    `  baseUrl: '${input.origin}',`,
    '  accessToken: process.env.AMA_ACCESS_TOKEN ?? "",',
    '})',
    `const session = await client.sessions.get('${input.sessionId}')`,
    `const events = await client.sessions.listEvents('${input.sessionId}')`,
  ].join('\n')
  return { curl, restish, sdk }
}
