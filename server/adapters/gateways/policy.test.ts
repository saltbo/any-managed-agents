import type { AuthScope } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

const resolveEffectivePolicyMock = vi.fn()
const evaluateMcpToolPolicyMock = vi.fn()
const evaluateProviderPolicyMock = vi.fn()

vi.mock('../../policy', () => ({
  resolveEffectivePolicy: resolveEffectivePolicyMock,
  evaluateMcpToolPolicy: evaluateMcpToolPolicyMock,
  evaluateProviderPolicy: evaluateProviderPolicyMock,
}))

const { createPolicyPort } = await import('./policy')

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const fakeDb = {} as Parameters<typeof createPolicyPort>[0]

const effectivePolicy = {
  source: 'project',
  sources: ['project'],
  toolPolicy: { blockedTools: [] },
  mcpPolicy: { defaultEffect: 'allow' },
  sandboxPolicy: {},
  accessRules: [],
}

const allowedDecision = { allowed: true, category: 'provider', rule: null, message: 'Allowed.' }

describe('[spec: policy/gateway] createPolicyPort', () => {
  it('returns a port with all required methods', () => {
    const port = createPolicyPort(fakeDb)
    expect(typeof port.resolveToolPolicy).toBe('function')
    expect(typeof port.resolveMcpPolicy).toBe('function')
    expect(typeof port.evaluateMcpTool).toBe('function')
    expect(typeof port.resolveEffective).toBe('function')
    expect(typeof port.evaluateProvider).toBe('function')
  })

  it('resolveToolPolicy returns the toolPolicy from the effective policy', async () => {
    resolveEffectivePolicyMock.mockResolvedValueOnce(effectivePolicy)
    const port = createPolicyPort(fakeDb)
    const result = await port.resolveToolPolicy(auth)
    expect(result).toBe(effectivePolicy.toolPolicy)
    expect(resolveEffectivePolicyMock).toHaveBeenCalledWith(fakeDb, auth)
  })

  it('resolveMcpPolicy returns the mcpPolicy from the effective policy', async () => {
    resolveEffectivePolicyMock.mockResolvedValueOnce(effectivePolicy)
    const port = createPolicyPort(fakeDb)
    const result = await port.resolveMcpPolicy(auth)
    expect(result).toBe(effectivePolicy.mcpPolicy)
    expect(resolveEffectivePolicyMock).toHaveBeenCalledWith(fakeDb, auth)
  })

  it('evaluateMcpTool delegates to evaluateMcpToolPolicy', async () => {
    evaluateMcpToolPolicyMock.mockResolvedValueOnce(allowedDecision)
    const port = createPolicyPort(fakeDb)
    const values = {
      connectorId: 'connector_1',
      toolName: 'bash',
      session: { id: 'sess_1', agentSnapshot: null, environmentSnapshot: null },
    }
    const result = await port.evaluateMcpTool(auth, values)
    expect(result).toBe(allowedDecision)
    expect(evaluateMcpToolPolicyMock).toHaveBeenCalledWith(fakeDb, auth, values)
  })

  it('resolveEffective returns all effective policy fields', async () => {
    resolveEffectivePolicyMock.mockResolvedValueOnce(effectivePolicy)
    const port = createPolicyPort(fakeDb)
    const result = await port.resolveEffective(auth)
    expect(result).toEqual({
      source: effectivePolicy.source,
      sources: effectivePolicy.sources,
      accessRules: effectivePolicy.accessRules,
      toolPolicy: effectivePolicy.toolPolicy,
      mcpPolicy: effectivePolicy.mcpPolicy,
      sandboxPolicy: effectivePolicy.sandboxPolicy,
    })
  })

  it('evaluateProvider delegates to evaluateProviderPolicy', async () => {
    evaluateProviderPolicyMock.mockResolvedValueOnce(allowedDecision)
    const port = createPolicyPort(fakeDb)
    const values = { providerId: 'prov_1', modelId: 'model_1' }
    const result = await port.evaluateProvider(auth, values)
    expect(result).toBe(allowedDecision)
    expect(evaluateProviderPolicyMock).toHaveBeenCalledWith(fakeDb, auth, values)
  })

  it('propagates resolveEffectivePolicy rejection through resolveToolPolicy', async () => {
    resolveEffectivePolicyMock.mockRejectedValueOnce(new Error('policy db error'))
    const port = createPolicyPort(fakeDb)
    await expect(port.resolveToolPolicy(auth)).rejects.toThrow('policy db error')
  })

  it('propagates resolveEffectivePolicy rejection through resolveMcpPolicy', async () => {
    resolveEffectivePolicyMock.mockRejectedValueOnce(new Error('policy db error'))
    const port = createPolicyPort(fakeDb)
    await expect(port.resolveMcpPolicy(auth)).rejects.toThrow('policy db error')
  })

  it('propagates resolveEffectivePolicy rejection through resolveEffective', async () => {
    resolveEffectivePolicyMock.mockRejectedValueOnce(new Error('policy db error'))
    const port = createPolicyPort(fakeDb)
    await expect(port.resolveEffective(auth)).rejects.toThrow('policy db error')
  })

  it('propagates evaluateMcpToolPolicy rejection', async () => {
    evaluateMcpToolPolicyMock.mockRejectedValueOnce(new Error('mcp tool policy error'))
    const port = createPolicyPort(fakeDb)
    const values = {
      connectorId: 'connector_1',
      toolName: 'bash',
      session: { id: 'sess_1', agentSnapshot: null, environmentSnapshot: null },
    }
    await expect(port.evaluateMcpTool(auth, values)).rejects.toThrow('mcp tool policy error')
  })

  it('propagates evaluateProviderPolicy rejection', async () => {
    evaluateProviderPolicyMock.mockRejectedValueOnce(new Error('provider policy error'))
    const port = createPolicyPort(fakeDb)
    await expect(port.evaluateProvider(auth, { providerId: 'prov_1', modelId: 'model_1' })).rejects.toThrow(
      'provider policy error',
    )
  })
})
