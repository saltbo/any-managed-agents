import { describe, expect, it } from 'vitest'
import { type Agent, ApiError } from '@/lib/api'
import {
  agentApiExamples,
  apiErrorToBuilder,
  builderClientErrors,
  coreStepErrors,
  draftFromGoal,
  emptyBuilderDraft,
  rolesStepErrors,
  toAgentInput,
} from './agent-builder-model'

const validDraft = {
  ...emptyBuilderDraft,
  name: 'Review agent',
  instructions: 'Review changes carefully.',
}

describe('agent builder model', () => {
  it('drafts a configuration from a natural-language goal', () => {
    const draft = draftFromGoal('Review incoming pull requests and summarize risky changes for the team')
    expect(draft.name).toBe('Review incoming pull requests and summarize agent')
    expect(draft.instructions).toContain('Review incoming pull requests')
    expect(draft.model).toBe('@cf/moonshotai/kimi-k2.6')
    expect(draft.allowedTools).toBe('read\nwrite\nshell')
  })

  it('requires name, instructions, provider, and model in the core step', () => {
    expect(coreStepErrors(emptyBuilderDraft)).toMatchObject({
      name: expect.any(String),
      instructions: expect.any(String),
    })
    expect(coreStepErrors(validDraft)).toEqual({})
  })

  it('validates handoff target lines in the roles step', () => {
    expect(rolesStepErrors({ ...validDraft, handoffTargets: 'role=worker\ncapability=implementation' })).toEqual({})
    expect(rolesStepErrors({ ...validDraft, handoffTargets: 'board=kanban' })).toMatchObject({
      handoffTargets: expect.stringContaining('board=kanban'),
    })
    expect(builderClientErrors({ ...emptyBuilderDraft, handoffTargets: 'nope' })).toMatchObject({
      name: expect.any(String),
      handoffTargets: expect.any(String),
    })
  })

  it('builds a generic agent input including roles, handoff, and memory policy', () => {
    const input = toAgentInput({
      ...validDraft,
      sandboxEnabled: true,
      skills: 'ama@coding-agent',
      role: 'maintainer',
      capabilityTags: 'triage',
      handoffTargets: 'role=worker\ncapability=implementation',
      memoryEnabled: true,
    })
    expect(input).toMatchObject({
      name: 'Review agent',
      instructions: 'Review changes carefully.',
      skills: ['ama@coding-agent'],
      role: 'maintainer',
      capabilityTags: ['triage'],
      handoffPolicy: { targets: [{ role: 'worker' }, { capability: 'implementation' }] },
      memoryPolicy: { enabled: true, scope: 'project' },
    })
    expect(toAgentInput(validDraft)).toMatchObject({
      skills: [],
      role: null,
      handoffPolicy: {},
      memoryPolicy: { enabled: false },
    })
  })

  it('maps server validation fields onto builder fields and steps', () => {
    const error = new ApiError('Invalid agent configuration', 400, {
      error: {
        type: 'validation_error',
        message: 'Invalid agent configuration',
        details: { fields: { tools: 'Tool is blocked by policy: secrets.read', name: 'Name is required.' } },
      },
    })
    expect(apiErrorToBuilder(error)).toEqual({
      errors: { allowedTools: 'Tool is blocked by policy: secrets.read', name: 'Name is required.' },
      step: 'core',
    })
    expect(apiErrorToBuilder(new Error('network down'))).toEqual({ errors: {}, step: null })
  })

  it('renders secret-free API examples against the platform origin', () => {
    const agent = {
      id: 'agent_123',
      name: 'Review agent',
      description: null,
      instructions: 'Review changes.',
      providerId: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      skills: [],
      tools: [{ name: 'read' }],
      mcpConnectors: [],
      role: 'maintainer',
      capabilityTags: [],
      handoffPolicy: {},
      memoryPolicy: { enabled: false },
    } as unknown as Agent
    const examples = agentApiExamples('https://ama.example.com', agent)
    expect(examples.curl).toContain('https://ama.example.com/api/v1/agents')
    expect(examples.restish).toContain('https://ama.example.com/api/v1/agents/agent_123')
    expect(examples.curl).toContain('$AMA_ACCESS_TOKEN')
    expect(examples.curl).not.toMatch(/api\.(openai|anthropic)\.com/)
    expect(`${examples.curl}${examples.restish}`).not.toMatch(/Bearer [A-Za-z0-9]/)
  })
})
