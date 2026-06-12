import { parseTools } from '@/console/format'
import { type Agent, type AgentInput, ApiError } from '@/lib/api'

export const BUILDER_STEPS = ['start', 'core', 'tools', 'sandbox', 'roles', 'test', 'done'] as const
export type BuilderStep = (typeof BUILDER_STEPS)[number]

export const BUILDER_STEP_TITLES: Record<BuilderStep, string> = {
  start: 'Goal',
  core: 'Core settings',
  tools: 'Tools and approvals',
  sandbox: 'Sandbox access',
  roles: 'Roles and memory',
  test: 'Test and publish',
  done: 'API examples',
}

export interface AgentBuilderDraft {
  name: string
  description: string
  instructions: string
  provider: string
  model: string
  allowedTools: string
  mcpConnectors: string[]
  sandboxEnabled: boolean
  skills: string
  role: string
  capabilityTags: string
  handoffTargets: string
  memoryEnabled: boolean
}

export const DEFAULT_BUILDER_PROVIDER = 'workers-ai'
export const DEFAULT_BUILDER_MODEL = '@cf/moonshotai/kimi-k2.6'

export const emptyBuilderDraft: AgentBuilderDraft = {
  name: '',
  description: '',
  instructions: '',
  provider: DEFAULT_BUILDER_PROVIDER,
  model: DEFAULT_BUILDER_MODEL,
  allowedTools: '',
  mcpConnectors: [],
  sandboxEnabled: false,
  skills: '',
  role: '',
  capabilityTags: '',
  handoffTargets: '',
  memoryEnabled: false,
}

export interface AgentTemplate {
  id: string
  name: string
  summary: string
  draft: AgentBuilderDraft
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'coding',
    name: 'Coding agent',
    summary: 'Implements changes and runs checks inside a managed sandbox.',
    draft: {
      ...emptyBuilderDraft,
      name: 'Coding agent',
      description: 'Executes development work in a managed sandbox.',
      instructions: 'You are a focused coding agent. Make changes, run checks, and report the result.',
      allowedTools: 'read\nwrite\nshell',
      sandboxEnabled: true,
      skills: 'ama@coding-agent',
    },
  },
  {
    id: 'research',
    name: 'Research assistant',
    summary: 'Investigates questions and answers with citations.',
    draft: {
      ...emptyBuilderDraft,
      name: 'Research assistant',
      description: 'Investigates questions and reports findings with sources.',
      instructions:
        'You are a research assistant. Investigate the question, verify sources, and answer with citations.',
      allowedTools: 'web.search',
    },
  },
  {
    id: 'triage',
    name: 'Operations triage',
    summary: 'Reviews incoming work and hands it to the right specialist agent.',
    draft: {
      ...emptyBuilderDraft,
      name: 'Operations triage',
      description: 'Classifies incoming work and delegates by role or capability.',
      instructions:
        'You are a triage agent. Classify incoming work, summarize the decision, and hand off to a matching agent.',
      allowedTools: 'read',
      role: 'maintainer',
      capabilityTags: 'triage',
      handoffTargets: 'role=worker',
      memoryEnabled: true,
    },
  },
]

export function draftFromGoal(goal: string): AgentBuilderDraft {
  const trimmed = goal.trim().replaceAll(/\s+/g, ' ')
  const headline = trimmed.split(' ').slice(0, 6).join(' ')
  return {
    ...emptyBuilderDraft,
    name: `${headline.charAt(0).toUpperCase()}${headline.slice(1)} agent`.slice(0, 120),
    description: trimmed.slice(0, 1000),
    instructions: `You are a managed agent.\nGoal: ${trimmed}\nWork in small verifiable steps and report what you did.`,
    allowedTools: 'read\nwrite\nshell',
  }
}

export type BuilderFieldErrors = Partial<Record<keyof AgentBuilderDraft, string>>

const HANDOFF_TARGET_PATTERN = /^(role|capability)=[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/

export function coreStepErrors(draft: AgentBuilderDraft): BuilderFieldErrors {
  const errors: BuilderFieldErrors = {}
  if (!draft.name.trim()) errors.name = 'Name is required.'
  else if (draft.name.trim().length > 120) errors.name = 'Name must be 120 characters or fewer.'
  if (!draft.instructions.trim()) errors.instructions = 'Instructions are required.'
  if (!draft.model.trim()) errors.model = 'Model is required.'
  if (!draft.provider.trim()) errors.provider = 'Provider is required.'
  return errors
}

export function rolesStepErrors(draft: AgentBuilderDraft): BuilderFieldErrors {
  const invalid = parseTools(draft.handoffTargets).find((line) => !HANDOFF_TARGET_PATTERN.test(line))
  return invalid === undefined
    ? {}
    : { handoffTargets: `Handoff targets use role=<role> or capability=<capability> per line: ${invalid}` }
}

export function builderClientErrors(draft: AgentBuilderDraft): BuilderFieldErrors {
  return { ...coreStepErrors(draft), ...rolesStepErrors(draft) }
}

export function stepErrors(step: BuilderStep, draft: AgentBuilderDraft): BuilderFieldErrors {
  if (step === 'core') return coreStepErrors(draft)
  if (step === 'roles') return rolesStepErrors(draft)
  return {}
}

export function parseHandoffTargets(value: string) {
  return parseTools(value).map((line) => {
    const [kind, target] = line.split('=')
    return kind === 'role' ? { role: target } : { capability: target }
  })
}

export function toAgentInput(draft: AgentBuilderDraft): AgentInput {
  const targets = parseHandoffTargets(draft.handoffTargets)
  const description = draft.description.trim()
  return {
    name: draft.name.trim(),
    ...(description ? { description } : {}),
    instructions: draft.instructions.trim(),
    systemPrompt: draft.instructions.trim(),
    provider: draft.provider.trim(),
    model: draft.model.trim(),
    skills: draft.sandboxEnabled ? parseTools(draft.skills) : [],
    allowedTools: parseTools(draft.allowedTools),
    mcpConnectors: draft.mcpConnectors,
    role: draft.role.trim() || null,
    capabilityTags: parseTools(draft.capabilityTags),
    handoffPolicy: targets.length > 0 ? { targets } : {},
    memoryPolicy: draft.memoryEnabled ? { enabled: true, scope: 'project' } : { enabled: false },
  }
}

const SERVER_FIELD_MAP: Record<string, { field: keyof AgentBuilderDraft; step: BuilderStep }> = {
  name: { field: 'name', step: 'core' },
  description: { field: 'description', step: 'core' },
  instructions: { field: 'instructions', step: 'core' },
  systemPrompt: { field: 'instructions', step: 'core' },
  provider: { field: 'provider', step: 'core' },
  model: { field: 'model', step: 'core' },
  allowedTools: { field: 'allowedTools', step: 'tools' },
  mcpConnectors: { field: 'mcpConnectors', step: 'tools' },
  skills: { field: 'skills', step: 'sandbox' },
  role: { field: 'role', step: 'roles' },
  capabilityTags: { field: 'capabilityTags', step: 'roles' },
  handoffPolicy: { field: 'handoffTargets', step: 'roles' },
  memoryPolicy: { field: 'memoryEnabled', step: 'roles' },
}

export function apiErrorToBuilder(error: unknown): { errors: BuilderFieldErrors; step: BuilderStep | null } {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object') {
    return { errors: {}, step: null }
  }
  const body = error.details as { error?: { details?: { fields?: Record<string, unknown> } } }
  const fields = body.error?.details?.fields
  if (!fields || typeof fields !== 'object') {
    return { errors: {}, step: null }
  }
  const errors: BuilderFieldErrors = {}
  const steps = new Set<BuilderStep>()
  for (const [serverField, message] of Object.entries(fields)) {
    const mapped = SERVER_FIELD_MAP[serverField]
    if (mapped && typeof message === 'string') {
      errors[mapped.field] = message
      steps.add(mapped.step)
    }
  }
  return { errors, step: BUILDER_STEPS.find((step) => steps.has(step)) ?? null }
}

export function agentApiExamples(origin: string, agent: Agent) {
  const body = JSON.stringify({
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.instructions ? { instructions: agent.instructions } : {}),
    provider: agent.provider,
    model: agent.model,
    skills: agent.skills,
    allowedTools: agent.allowedTools,
    mcpConnectors: agent.mcpConnectors,
    ...(agent.role ? { role: agent.role } : {}),
    capabilityTags: agent.capabilityTags,
    handoffPolicy: agent.handoffPolicy,
    memoryPolicy: agent.memoryPolicy,
  })
  const curl = [
    `curl -X POST "${origin}/api/agents" \\`,
    '  -H "Authorization: Bearer $AMA_ACCESS_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '${body}'`,
  ].join('\n')
  const restish = [
    `printf '%s\\n' '${body}' | restish post ${origin}/api/agents -H "Authorization: Bearer $AMA_ACCESS_TOKEN"`,
    `restish get ${origin}/api/agents/${agent.id} -H "Authorization: Bearer $AMA_ACCESS_TOKEN"`,
  ].join('\n')
  return { curl, restish }
}
