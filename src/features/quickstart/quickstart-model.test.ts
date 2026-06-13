import { describe, expect, it } from 'vitest'
import type { Agent, Environment, Provider, Session } from '@/lib/api'
import {
  agentHasSandboxExecution,
  defaultQuickstartEnvironmentForm,
  firstIncompleteStep,
  isStepUnlocked,
  quickstartCompletion,
  quickstartEnvironmentInput,
  quickstartIntegrationExamples,
  resolveQuickstartStep,
  sandboxAgentInput,
} from './quickstart-model'

const activeProvider = { enabled: true } as Provider
const activeEnvironment = { archivedAt: null } as Environment
const activeAgent = { archivedAt: null } as Agent
const cloudSession = { state: 'idle' } as Session

const emptyResources = { providers: [], environments: [], agents: [], sessions: [] }

describe('quickstart step sequencing [spec: quickstart/step-sequencing]', () => {
  it('detects completion from real resource state', () => {
    expect(quickstartCompletion(emptyResources)).toEqual({
      provider: false,
      environment: false,
      agent: false,
      session: false,
      integration: false,
    })
    expect(
      quickstartCompletion({
        providers: [activeProvider],
        environments: [activeEnvironment],
        agents: [activeAgent],
        sessions: [cloudSession],
      }),
    ).toEqual({ provider: true, environment: true, agent: true, session: true, integration: true })
  })

  it('unlocks completed steps and the next incomplete step only', () => {
    const completion = quickstartCompletion({
      providers: [activeProvider],
      environments: [],
      agents: [activeAgent],
      sessions: [],
    })
    expect(firstIncompleteStep(completion)).toBe('environment')
    expect(isStepUnlocked('provider', completion)).toBe(true)
    expect(isStepUnlocked('environment', completion)).toBe(true)
    expect(isStepUnlocked('agent', completion)).toBe(true)
    expect(isStepUnlocked('session', completion)).toBe(false)
    expect(isStepUnlocked('integration', completion)).toBe(false)
  })

  it('resolves the requested step only when it is unlocked', () => {
    const completion = quickstartCompletion({ providers: [activeProvider], environments: [], agents: [], sessions: [] })
    expect(resolveQuickstartStep(null, completion)).toBe('environment')
    expect(resolveQuickstartStep('provider', completion)).toBe('provider')
    expect(resolveQuickstartStep('session', completion)).toBe('environment')
    expect(resolveQuickstartStep('nonsense', completion)).toBe('environment')
  })
})

describe('quickstart step sequencing — all-complete fallback [spec: quickstart/step-sequencing]', () => {
  it('returns integration when all steps are complete (firstIncompleteStep fallback)', () => {
    const completion = quickstartCompletion({
      providers: [{ enabled: true } as import('@/lib/api').Provider],
      environments: [{ archivedAt: null } as import('@/lib/api').Environment],
      agents: [{ archivedAt: null } as import('@/lib/api').Agent],
      sessions: [{ state: 'idle' } as import('@/lib/api').Session],
    })
    expect(firstIncompleteStep(completion)).toBe('integration')
    // resolveQuickstartStep with null falls to firstIncompleteStep → 'integration'
    expect(resolveQuickstartStep(null, completion)).toBe('integration')
  })
})

describe('quickstart environment input [spec: quickstart/environment-input]', () => {
  it('creates an unrestricted cloud environment', () => {
    expect(quickstartEnvironmentInput({ ...defaultQuickstartEnvironmentForm, name: ' Env ' })).toMatchObject({
      name: 'Env',
      hostingMode: 'cloud',
      networkPolicy: { mode: 'unrestricted' },
    })
  })

  it('blocks package-manager registry access when packageManagerAccess is false', () => {
    const input = quickstartEnvironmentInput({
      name: 'Blocked env',
      networkChoice: 'restricted',
      allowedHosts: '',
      mcpAccess: true,
      packageManagerAccess: false,
    })
    expect(input.packageManagerPolicy).toEqual({ allowedRegistries: [] })
    expect(input.mcpPolicy).toEqual({ allowedConnectors: ['*'] })
  })

  it('captures allowed hosts, MCP access, and package-manager access for limited networking', () => {
    const input = quickstartEnvironmentInput({
      name: 'Limited env',
      networkChoice: 'restricted',
      allowedHosts: 'registry.npmjs.org\n  api.github.com  \n',
      mcpAccess: false,
      packageManagerAccess: true,
    })
    expect(input.networkPolicy).toEqual({
      mode: 'restricted',
      allowedHosts: ['registry.npmjs.org', 'api.github.com'],
    })
    expect(input.mcpPolicy).toEqual({ blockedConnectors: ['*'] })
    expect(input.packageManagerPolicy).toEqual({ allowedRegistries: ['registry.npmjs.org'] })
  })
})

describe('quickstart sandbox add-on [spec: quickstart/sandbox-addon]', () => {
  it('adds sandbox tools and carries skills consistent with the agent schema', () => {
    const agent = { tools: [{ name: 'read' }, { name: 'sandbox.exec' }], skills: [] } as unknown as Agent
    expect(agentHasSandboxExecution(agent)).toBe(true)
    expect(agentHasSandboxExecution({ tools: [{ name: 'read' }], skills: [] } as unknown as Agent)).toBe(false)
    expect(sandboxAgentInput(agent)).toEqual({
      tools: [{ name: 'read' }, { name: 'sandbox.exec' }, { name: 'sandbox.read' }, { name: 'sandbox.write' }],
      skills: ['ama@coding-agent'],
    })
    expect(sandboxAgentInput({ tools: [], skills: ['team@skill'] } as unknown as Agent).skills).toEqual(['team@skill'])
  })
})

describe('quickstart integration examples [spec: quickstart/integration-examples]', () => {
  const examples = quickstartIntegrationExamples({
    origin: 'https://ama.example.com',
    agentId: 'agent_123',
    environmentId: 'env_456',
    sessionId: 'sess_789',
    runtimePath: '/runtime/sessions/sess_789/rpc',
  })

  it('targets the platform origin with the created resource ids', () => {
    for (const example of [examples.curl, examples.restish, examples.sdk]) {
      expect(example).toContain('https://ama.example.com')
      expect(example).toContain('sess_789')
    }
    expect(examples.curl).toContain('agent_123')
    expect(examples.curl).toContain('env_456')
    expect(examples.restish).toContain('/api/v1/openapi.json')
  })

  it('uses AMA session endpoints for live traffic and never embeds secrets or vendor URLs', () => {
    expect(examples.curl).toContain('/runtime/sessions/sess_789/rpc')
    const combined = `${examples.curl}\n${examples.restish}\n${examples.sdk}`
    expect(combined).toContain('$AMA_ACCESS_TOKEN')
    expect(combined).not.toMatch(/Bearer [A-Za-z0-9]/)
    expect(combined).not.toMatch(/\b(?:api\.)?(?:openai|anthropic)\.com\b/)
  })

  it('falls back to session events URL when runtimePath is null', () => {
    const examplesNoPath = quickstartIntegrationExamples({
      origin: 'https://ama.example.com',
      agentId: 'agent_123',
      environmentId: 'env_456',
      sessionId: 'sess_789',
      runtimePath: null,
    })
    expect(examplesNoPath.curl).toContain('/api/v1/sessions/sess_789/events')
    expect(examplesNoPath.curl).not.toContain('/runtime/')
  })
})
