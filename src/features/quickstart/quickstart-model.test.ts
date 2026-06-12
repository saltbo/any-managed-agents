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

const activeProvider = { status: 'active' } as Provider
const activeEnvironment = { status: 'active' } as Environment
const activeAgent = { status: 'active' } as Agent
const cloudSession = { runtimeEndpointPath: '/runtime/sessions/abc/rpc' } as Session

const emptyResources = { providers: [], environments: [], agents: [], sessions: [] }

describe('quickstart step sequencing', () => {
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

describe('quickstart environment input', () => {
  it('creates an unrestricted cloud environment', () => {
    expect(quickstartEnvironmentInput({ ...defaultQuickstartEnvironmentForm, name: ' Env ' })).toMatchObject({
      name: 'Env',
      hostingMode: 'cloud',
      networkPolicy: { mode: 'unrestricted' },
    })
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

describe('quickstart sandbox add-on', () => {
  it('adds sandbox tools and carries skills consistent with the agent schema', () => {
    const agent = { allowedTools: ['read', 'sandbox.exec'], skills: [] } as unknown as Agent
    expect(agentHasSandboxExecution(agent)).toBe(true)
    expect(agentHasSandboxExecution({ allowedTools: ['read'], skills: [] } as unknown as Agent)).toBe(false)
    expect(sandboxAgentInput(agent)).toEqual({
      allowedTools: ['read', 'sandbox.exec', 'sandbox.read', 'sandbox.write'],
      skills: ['ama@coding-agent'],
    })
    expect(sandboxAgentInput({ allowedTools: [], skills: ['team@skill'] } as unknown as Agent).skills).toEqual([
      'team@skill',
    ])
  })
})

describe('quickstart integration examples', () => {
  const examples = quickstartIntegrationExamples({
    origin: 'https://ama.example.com',
    agentId: 'agent_123',
    environmentId: 'env_456',
    sessionId: 'sess_789',
    runtimeEndpointPath: '/runtime/sessions/sess_789/rpc',
  })

  it('targets the platform origin with the created resource ids', () => {
    for (const example of [examples.curl, examples.restish, examples.sdk]) {
      expect(example).toContain('https://ama.example.com')
      expect(example).toContain('sess_789')
    }
    expect(examples.curl).toContain('agent_123')
    expect(examples.curl).toContain('env_456')
    expect(examples.restish).toContain('/api/openapi.json')
  })

  it('uses AMA session endpoints for live traffic and never embeds secrets or vendor URLs', () => {
    expect(examples.curl).toContain('/runtime/sessions/sess_789/rpc')
    const combined = `${examples.curl}\n${examples.restish}\n${examples.sdk}`
    expect(combined).toContain('$AMA_ACCESS_TOKEN')
    expect(combined).not.toMatch(/Bearer [A-Za-z0-9]/)
    expect(combined).not.toMatch(/\b(?:api\.)?(?:openai|anthropic)\.com\b/)
  })
})
