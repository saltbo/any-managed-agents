/**
 * agent-builder-model extensions — pure logic tests.
 * No API calls, no MSW, no rendering.
 */
import { describe, expect, it } from 'vitest'
import type { Agent } from '@/lib/amarpc'
import { ApiError } from '@/lib/amarpc'
import { type AgentOverrides, agent as resourceAgent } from '@/test/resource-fixtures'
import {
  agentApiExamples,
  apiErrorToBuilder,
  emptyBuilderDraft,
  parseHandoffTargets,
  stepErrors,
  toAgentInput,
} from './agent-builder-model'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent(overrides)
}

describe('[spec: agents/builder] agent-builder-model extensions', () => {
  // ─── stepErrors ────────────────────────────────────────────────────────────

  it('stepErrors returns empty object for non-core, non-roles steps', () => {
    expect(stepErrors('start', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('tools', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('sandbox', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('test', emptyBuilderDraft)).toEqual({})
    expect(stepErrors('done', emptyBuilderDraft)).toEqual({})
  })

  it('stepErrors delegates to coreStepErrors for core step', () => {
    const errors = stepErrors('core', emptyBuilderDraft)
    expect(errors.name).toBeTruthy()
    expect(errors.systemPrompt).toBeTruthy()
  })

  it('stepErrors delegates to rolesStepErrors for roles step with invalid target', () => {
    const errors = stepErrors('roles', { ...emptyBuilderDraft, handoffTargets: 'invalid=nope' })
    expect(errors.handoffTargets).toBeTruthy()
  })

  it('coreStepErrors returns error when name is too long (121 chars)', () => {
    const errors = stepErrors('core', { ...emptyBuilderDraft, name: 'A'.repeat(121), systemPrompt: 'B' })
    expect(errors.name).toContain('120 characters')
  })

  it('coreStepErrors returns no model/provider error when model and provider are set', () => {
    const errors = stepErrors('core', {
      ...emptyBuilderDraft,
      name: 'Valid name',
      systemPrompt: 'Valid system prompt',
      model: '@cf/some-model',
      provider: 'workers-ai',
    })
    expect(errors.model).toBeUndefined()
    expect(errors.provider).toBeUndefined()
  })

  // ─── parseHandoffTargets ───────────────────────────────────────────────────

  it('parseHandoffTargets parses role= lines', () => {
    expect(parseHandoffTargets('role=worker')).toEqual([{ role: 'worker' }])
  })

  it('parseHandoffTargets parses capability= lines', () => {
    expect(parseHandoffTargets('capability=implementation')).toEqual([{ capability: 'implementation' }])
  })

  it('parseHandoffTargets parses multiple targets on separate lines', () => {
    expect(parseHandoffTargets('role=worker\ncapability=code-review')).toEqual([
      { role: 'worker' },
      { capability: 'code-review' },
    ])
  })

  it('parseHandoffTargets returns empty array for empty string', () => {
    expect(parseHandoffTargets('')).toEqual([])
  })

  // ─── toAgentInput ──────────────────────────────────────────────────────────

  it('toAgentInput includes description only when non-empty', () => {
    const withDesc = toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', description: 'Desc' })
    expect(withDesc.description).toBe('Desc')
    const withoutDesc = toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', description: '' })
    expect(withoutDesc.description).toBeUndefined()
  })

  it('toAgentInput sets skills to empty array when sandboxEnabled is false', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      systemPrompt: 'B',
      sandboxEnabled: false,
      skills: 'ama@coding-agent',
    })
    expect(result.skills).toEqual([])
  })

  it('toAgentInput includes skills when sandboxEnabled is true', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      systemPrompt: 'B',
      sandboxEnabled: true,
      skills: 'ama@coding-agent\nama@test',
    })
    expect(result.skills).toEqual(['ama@coding-agent', 'ama@test'])
  })

  it('toAgentInput sets handoff with targets when targets are present', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      systemPrompt: 'B',
      handoffTargets: 'role=worker',
    })
    expect(result.handoff).toEqual({
      enabled: true,
      accepts: { roles: [], capabilities: [] },
      targets: [{ role: 'worker' }],
    })
  })

  it('toAgentInput disables handoff when no roles, capabilities, or targets are present', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', handoffTargets: '' })
    expect(result.handoff).toEqual({ enabled: false, accepts: { roles: [], capabilities: [] }, targets: [] })
  })

  it('toAgentInput maps capability lines to handoff accepts', () => {
    const result = toAgentInput({
      ...emptyBuilderDraft,
      name: 'A',
      systemPrompt: 'B',
      capabilityTags: 'triage\ncode-review',
    })
    expect(result.handoff?.accepts.capabilities).toEqual(['triage', 'code-review'])
  })

  it('toAgentInput maps role null when role is empty string', () => {
    expect(toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', role: '' }).role).toBeNull()
  })

  it('toAgentInput maps role string when role is set', () => {
    expect(toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', role: 'maintainer' }).role).toBe(
      'maintainer',
    )
  })

  it('toAgentInput maps allowedTools to tools array', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', allowedTools: 'read\nwrite' })
    expect(result.tools).toEqual([{ name: 'read' }, { name: 'write' }])
  })

  it('toAgentInput passes mcpConnectors array directly', () => {
    const result = toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', mcpConnectors: ['c1', 'c2'] })
    expect(result.mcpConnectors).toEqual(['c1', 'c2'])
  })

  // ─── agentApiExamples ──────────────────────────────────────────────────────

  it('agentApiExamples includes description in curl body when agent.description is set', () => {
    const examples = agentApiExamples('https://example.com', buildAgent({ description: 'Does useful work' }))
    expect(examples.curl).toContain('"description":"Does useful work"')
  })

  it('agentApiExamples omits description when agent.description is null', () => {
    const examples = agentApiExamples('https://example.com', buildAgent({ description: null }))
    expect(examples.curl).not.toContain('"description"')
  })

  it('agentApiExamples omits system prompt when agent.systemPrompt is null', () => {
    const examples = agentApiExamples('https://example.com', buildAgent({ systemPrompt: null }))
    expect(examples.curl).not.toContain('"systemPrompt"')
  })

  it('agentApiExamples omits role when agent.role is null', () => {
    const examples = agentApiExamples('https://example.com', buildAgent({ role: null }))
    expect(examples.curl).not.toContain('"role"')
  })

  it('agentApiExamples includes system prompt when set', () => {
    const examples = agentApiExamples('https://example.com', buildAgent({ systemPrompt: 'Do the work' }))
    expect(examples.curl).toContain('"systemPrompt":"Do the work"')
  })

  it('agentApiExamples includes role when set', () => {
    const examples = agentApiExamples('https://example.com', buildAgent({ role: 'maintainer' }))
    expect(examples.curl).toContain('"role":"maintainer"')
  })

  // ─── apiErrorToBuilder ─────────────────────────────────────────────────────

  it('apiErrorToBuilder returns empty errors for non-ApiError', () => {
    expect(apiErrorToBuilder(new Error('plain error'))).toEqual({ errors: {}, step: null })
  })

  it('apiErrorToBuilder returns empty errors for ApiError without details object', () => {
    expect(apiErrorToBuilder(new ApiError('bad request', 400, null))).toEqual({ errors: {}, step: null })
  })

  it('apiErrorToBuilder maps server field errors to builder fields', () => {
    const err = new ApiError('unprocessable', 422, {
      error: { details: { fields: { name: 'Name is required', systemPrompt: 'Instructions missing' } } },
    })
    const result = apiErrorToBuilder(err)
    expect(result.errors.name).toBe('Name is required')
    expect(result.errors.systemPrompt).toBe('Instructions missing')
    expect(result.step).toBe('core')
  })

  it('apiErrorToBuilder returns null step when no fields match known server fields', () => {
    const err = new ApiError('unprocessable', 422, {
      error: { details: { fields: { unknownField: 'some error' } } },
    })
    const result = apiErrorToBuilder(err)
    expect(result.errors).toEqual({})
    expect(result.step).toBeNull()
  })

  it('apiErrorToBuilder returns empty errors when details.fields is missing', () => {
    expect(apiErrorToBuilder(new ApiError('unprocessable', 422, { error: { details: {} } }))).toEqual({
      errors: {},
      step: null,
    })
  })
})
