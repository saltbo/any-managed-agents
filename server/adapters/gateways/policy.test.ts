import type { AuthScope } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

const resolveEffectivePolicyMock = vi.fn()
const evaluateMcpToolPolicyMock = vi.fn()
const evaluateProviderPolicyMock = vi.fn()
const evaluateSandboxRuntimePolicyMock = vi.fn()
const policyBlocksSandboxOperationMock = vi.fn()
const toolPolicyRequiresApprovalMock = vi.fn()
const evaluateProviderPolicyForSessionMock = vi.fn()

vi.mock('../../policy', () => ({
  resolveEffectivePolicy: resolveEffectivePolicyMock,
  evaluateMcpToolPolicy: evaluateMcpToolPolicyMock,
  evaluateProviderPolicy: evaluateProviderPolicyMock,
  evaluateSandboxRuntimePolicy: evaluateSandboxRuntimePolicyMock,
  policyBlocksSandboxOperation: policyBlocksSandboxOperationMock,
  toolPolicyRequiresApproval: toolPolicyRequiresApprovalMock,
  evaluateProviderPolicyForSession: evaluateProviderPolicyForSessionMock,
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

  it('evaluateSandboxRuntime delegates to evaluateSandboxRuntimePolicy', async () => {
    const decision = { allowed: false, category: 'sandbox', rule: 'sandbox.command', message: 'Blocked.' }
    evaluateSandboxRuntimePolicyMock.mockResolvedValueOnce(decision)
    const port = createPolicyPort(fakeDb)
    const values = {
      session: { id: 'sess_1', agentSnapshot: null, environmentSnapshot: null },
      operation: 'command' as const,
      command: 'rm -rf /',
      host: null,
    }
    const result = await port.evaluateSandboxRuntime(auth, values)
    expect(result).toBe(decision)
    expect(evaluateSandboxRuntimePolicyMock).toHaveBeenCalledWith(fakeDb, auth, values)
  })

  it('policyBlocksSandboxOperation delegates to policyBlocksSandboxOperation', async () => {
    const blocked = {
      decision: { allowed: false, category: 'sandbox', rule: 'sandbox.network', message: 'Blocked host.' },
      operation: { operation: 'network', host: 'evil.example' },
    }
    policyBlocksSandboxOperationMock.mockResolvedValueOnce(blocked)
    const port = createPolicyPort(fakeDb)
    const values = {
      session: { id: 'sess_1', agentSnapshot: null, environmentSnapshot: null },
      toolName: 'bash',
      input: { command: 'curl evil.example' },
    }
    const result = await port.policyBlocksSandboxOperation(auth, values)
    expect(result).toBe(blocked)
    expect(policyBlocksSandboxOperationMock).toHaveBeenCalledWith(fakeDb, auth, values)
  })

  it('toolPolicyRequiresApproval delegates to toolPolicyRequiresApproval', async () => {
    toolPolicyRequiresApprovalMock.mockResolvedValueOnce(true)
    const port = createPolicyPort(fakeDb)
    const result = await port.toolPolicyRequiresApproval(auth, 'bash')
    expect(result).toBe(true)
    expect(toolPolicyRequiresApprovalMock).toHaveBeenCalledWith(fakeDb, auth, 'bash')
  })

  it('evaluateProviderForSession delegates to evaluateProviderPolicyForSession', async () => {
    const sessionDecision = { decision: allowedDecision, override: null }
    evaluateProviderPolicyForSessionMock.mockResolvedValueOnce(sessionDecision)
    const port = createPolicyPort(fakeDb)
    const values = { providerId: 'prov_1', modelId: 'model_1', adminOverride: true }
    const result = await port.evaluateProviderForSession(auth, values)
    expect(result).toBe(sessionDecision)
    expect(evaluateProviderPolicyForSessionMock).toHaveBeenCalledWith(fakeDb, auth, values)
  })

  it('propagates evaluateSandboxRuntimePolicy rejection', async () => {
    evaluateSandboxRuntimePolicyMock.mockRejectedValueOnce(new Error('sandbox policy error'))
    const port = createPolicyPort(fakeDb)
    await expect(
      port.evaluateSandboxRuntime(auth, {
        session: { id: 'sess_1', agentSnapshot: null, environmentSnapshot: null },
        operation: 'startup',
        command: null,
        host: null,
      }),
    ).rejects.toThrow('sandbox policy error')
  })
})
