import { describe, expect, it } from 'vitest'
import {
  accessRuleView,
  applicablePolicyLevels,
  canOverrideProviderPolicy,
  effectivePolicyFrom,
  environmentAllowsConnector,
  evaluateAccessRules,
  evaluateBudgets,
  evaluateSandboxRuntimeDecision,
  mergePolicyObjects,
  type PolicyLevel,
  policyBlocksConnector,
  policyBlocksTool,
  policyRequiresApproval,
  policyScopeChanged,
  sandboxOperationForRuntimeTool,
  sessionAllowsTool,
  toolPolicyRequiresApproval,
  validateBudgetScope,
  validatePolicyScope,
} from './policy'

describe('mergePolicyObjects', () => {
  it('unions blocked/denied/requireApproval lists across levels', () => {
    const merged = mergePolicyObjects([{ blockedTools: ['a'] }, { blockedTools: ['b'] }, { blockedTools: ['a', 'c'] }])
    expect(merged.blockedTools).toEqual(['a', 'b', 'c'])
  })

  it('intersects allow lists, with * as identity', () => {
    expect(mergePolicyObjects([{ allowedTools: ['*'] }, { allowedTools: ['a', 'b'] }]).allowedTools).toEqual(['a', 'b'])
    expect(mergePolicyObjects([{ allowedTools: ['a', 'b'] }, { allowedTools: ['b', 'c'] }]).allowedTools).toEqual(['b'])
  })

  it('makes defaultEffect deny sticky', () => {
    expect(mergePolicyObjects([{ defaultEffect: 'deny' }, { defaultEffect: 'allow' }]).defaultEffect).toBe('deny')
    expect(mergePolicyObjects([{ defaultEffect: 'allow' }, { defaultEffect: 'deny' }]).defaultEffect).toBe('deny')
  })

  it('ANDs booleans (false sticky) and takes the minimum number', () => {
    expect(mergePolicyObjects([{ enabled: true }, { enabled: false }]).enabled).toBe(false)
    expect(mergePolicyObjects([{ limit: 10 }, { limit: 3 }, { limit: 7 }]).limit).toBe(3)
  })

  it('keeps a restrictive network string sticky against a later relaxed value', () => {
    expect(mergePolicyObjects([{ network: 'offline' }, { network: 'unrestricted' }]).network).toBe('offline')
  })

  it('shallow-merges nested objects with the most specific level last', () => {
    const merged = mergePolicyObjects([{ approvals: { a: 1, b: 1 } }, { approvals: { b: 2, c: 2 } }])
    expect(merged.approvals).toEqual({ a: 1, b: 2, c: 2 })
  })

  it('takes the most specific scalar for unrelated keys', () => {
    expect(mergePolicyObjects([{ mode: 'a' }, { mode: 'b' }]).mode).toBe('b')
  })
})

describe('validatePolicyScope', () => {
  it('requires teamId for team scope', () => {
    expect(validatePolicyScope({ level: 'team' })).toEqual({ 'scope.teamId': expect.any(String) })
    expect(validatePolicyScope({ level: 'team', teamId: 't1' })).toBeNull()
  })

  it('rejects teamId on non-team scopes', () => {
    expect(validatePolicyScope({ level: 'project', teamId: 't1' })).toEqual({ 'scope.teamId': expect.any(String) })
    expect(validatePolicyScope({ level: 'project' })).toBeNull()
  })
})

describe('policyScopeChanged', () => {
  it('detects level and teamId changes', () => {
    expect(policyScopeChanged({ level: 'project' }, { level: 'project', teamId: null })).toBe(false)
    expect(policyScopeChanged({ level: 'organization' }, { level: 'project', teamId: null })).toBe(true)
    expect(policyScopeChanged({ level: 'team', teamId: 't2' }, { level: 'team', teamId: 't1' })).toBe(true)
  })
})

describe('validateBudgetScope', () => {
  it('requires the matching identifier for provider/model scopes', () => {
    expect(validateBudgetScope({ scope: 'provider' })).toEqual({ providerId: expect.any(String) })
    expect(validateBudgetScope({ scope: 'model' })).toEqual({ modelId: expect.any(String) })
    expect(validateBudgetScope({ scope: 'provider', providerId: 'p1' })).toBeNull()
    expect(validateBudgetScope({ scope: 'project' })).toBeNull()
  })
})

describe('[spec: governance/access-rules] accessRuleView', () => {
  it('drops wildcard scopes and omits an empty reason', () => {
    expect(accessRuleView({ providerId: '*', modelId: '*', effect: 'deny', reason: null })).toEqual({ effect: 'deny' })
    expect(accessRuleView({ providerId: 'p1', modelId: 'm1', effect: 'allow', reason: 'ok' })).toEqual({
      providerId: 'p1',
      modelId: 'm1',
      effect: 'allow',
      reason: 'ok',
    })
  })
})

function policyLevel(overrides: Partial<PolicyLevel> & Pick<PolicyLevel, 'id' | 'scope' | 'updatedAt'>): PolicyLevel {
  return {
    teamId: null,
    toolPolicy: '{}',
    mcpPolicy: '{}',
    sandboxPolicy: '{}',
    ...overrides,
  }
}

describe('[spec: governance/policy-hierarchy] applicablePolicyLevels', () => {
  it('orders org → teams → project and keeps the latest row per scope/team', () => {
    const rows: PolicyLevel[] = [
      policyLevel({ id: 'org_old', scope: 'organization', updatedAt: '2026-01-01' }),
      policyLevel({ id: 'org_new', scope: 'organization', updatedAt: '2026-02-01' }),
      policyLevel({ id: 'team_a', scope: 'team', teamId: 'team_a', updatedAt: '2026-01-10' }),
      policyLevel({ id: 'proj', scope: 'project', updatedAt: '2026-01-05' }),
    ]
    const levels = applicablePolicyLevels(rows, ['team_a'])
    expect(levels.map((level) => level.id)).toEqual(['org_new', 'team_a', 'proj'])
  })

  it('drops team rows whose teamId is not in the caller memberships', () => {
    const rows: PolicyLevel[] = [
      policyLevel({ id: 'team_a', scope: 'team', teamId: 'team_a', updatedAt: '2026-01-01' }),
      policyLevel({ id: 'team_b', scope: 'team', teamId: 'team_b', updatedAt: '2026-01-01' }),
    ]
    expect(applicablePolicyLevels(rows, ['team_b']).map((level) => level.id)).toEqual(['team_b'])
    expect(applicablePolicyLevels(rows, [])).toEqual([])
  })
})

describe('[spec: governance/policy-hierarchy] effectivePolicyFrom', () => {
  it('reports the most specific level as the source and the platform default when empty', () => {
    expect(effectivePolicyFrom([], []).source).toEqual({ type: 'platform_default', id: 'workers-ai-default' })
    const levels: PolicyLevel[] = [
      policyLevel({ id: 'org', scope: 'organization', updatedAt: '2026-01-01' }),
      policyLevel({ id: 'proj', scope: 'project', updatedAt: '2026-01-01' }),
    ]
    expect(effectivePolicyFrom(levels, []).source).toEqual({ type: 'project', id: 'proj' })
  })

  it('merges the policy objects across levels and normalizes access rule wildcards', () => {
    const levels: PolicyLevel[] = [
      policyLevel({ id: 'org', scope: 'organization', updatedAt: '2026-01-01', toolPolicy: '{"blockedTools":["a"]}' }),
      policyLevel({ id: 'proj', scope: 'project', updatedAt: '2026-01-01', toolPolicy: '{"blockedTools":["b"]}' }),
    ]
    const effective = effectivePolicyFrom(levels, [
      { id: 'r1', providerId: null, modelId: null, teamId: null, effect: 'deny', reason: null },
    ])
    expect(effective.toolPolicy.blockedTools).toEqual(['a', 'b'])
    expect(effective.accessRules[0]).toEqual({
      id: 'r1',
      providerId: '*',
      modelId: '*',
      teamId: null,
      effect: 'deny',
      reason: null,
    })
  })
})

describe('[spec: governance/access-rules] evaluateAccessRules', () => {
  it('denies on a matching deny rule, honoring team scoping', () => {
    expect(evaluateAccessRules([{ id: 'r', effect: 'deny', teamId: null, reason: 'no' }], [])?.rule).toBe('r')
    expect(evaluateAccessRules([{ id: 'r', effect: 'deny', teamId: 'team_a', reason: null }], [])).toBeNull()
    expect(evaluateAccessRules([{ id: 'r', effect: 'deny', teamId: 'team_a', reason: null }], ['team_a'])?.rule).toBe(
      'r',
    )
  })

  it('restricts a team-allow resource to members of an allowed team', () => {
    const rules = [{ id: 'allow_a', effect: 'allow', teamId: 'team_a', reason: null }]
    expect(evaluateAccessRules(rules, [])?.message).toBe('Provider is restricted to approved teams.')
    expect(evaluateAccessRules(rules, ['team_a'])).toBeNull()
  })
})

describe('[spec: governance/model-budget] evaluateBudgets', () => {
  const month = new Date().toISOString().slice(0, 7)

  it('denies when a matching budget window is exhausted', () => {
    const budgets = [
      { id: 'b', providerId: null, modelId: null, limitType: 'tokens', limitValue: 100, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 150, sessionId: 's1' }]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: 'm' })?.category).toBe(
      'budget',
    )
  })

  it('skips budgets scoped to a different provider/model', () => {
    const budgets = [
      { id: 'b', providerId: 'other', modelId: null, limitType: 'tokens', limitValue: 1, window: 'month' },
    ]
    const usage = [{ createdAt: `${month}-01T00:00:00.000Z`, costMicros: 0, totalTokens: 9999, sessionId: 's1' }]
    expect(evaluateBudgets(budgets, usage, { providerId: 'p', providerRowId: null, modelId: 'm' })).toBeNull()
  })
})

describe('canOverrideProviderPolicy', () => {
  it('allows only admin/owner roles', () => {
    expect(canOverrideProviderPolicy(['admin'])).toBe(true)
    expect(canOverrideProviderPolicy(['owner'])).toBe(true)
    expect(canOverrideProviderPolicy(['member'])).toBe(false)
    expect(canOverrideProviderPolicy([])).toBe(false)
  })
})

describe('mcp connector/tool rules', () => {
  it('blocks connectors by block list, allow list, and default deny', () => {
    expect(policyBlocksConnector({ blockedConnectors: ['c'] }, 'c')?.rule).toBe('mcpPolicy.blockedConnectors')
    expect(policyBlocksConnector({ allowedConnectors: ['other'] }, 'c')?.rule).toBe('mcpPolicy.allowedConnectors')
    expect(policyBlocksConnector({ defaultEffect: 'deny' }, 'c')?.rule).toBe('mcpPolicy.defaultEffect')
    expect(policyBlocksConnector({ allowedConnectors: ['c'] }, 'c')).toBeNull()
  })

  it('blocks tools symmetrically', () => {
    expect(policyBlocksTool({ blockedTools: ['t'] }, 't')?.rule).toBe('toolPolicy.blockedTools')
    expect(policyBlocksTool({ allowedTools: ['*'] }, 't')).toBeNull()
  })

  it('detects approval requirements from mode, connector, and tool lists', () => {
    expect(policyRequiresApproval({ connectorApprovalModes: { c: 'require_approval' } }, 'c', 't')).toBe(true)
    expect(policyRequiresApproval({ requireApprovalTools: ['t'] }, 'c', 't')).toBe(true)
    expect(policyRequiresApproval({}, 'c', 't')).toBe(false)
    expect(toolPolicyRequiresApproval({ requireApprovalTools: ['*'] }, 't')).toBe(true)
  })
})

describe('session/environment tool gating', () => {
  it('allows when no agent snapshot and gates by snapshot tool names', () => {
    expect(sessionAllowsTool(null, 'c', 't')).toBe(true)
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":[]}' }, 'c', 't')).toBe(false)
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":["mcp:c"]}' }, 'c', 't')).toBe(true)
    expect(sessionAllowsTool({ agentSnapshot: '{"tools":["mcp:c.t"]}' }, 'c', 't')).toBe(true)
  })

  it('gates connectors by the environment mcp policy', () => {
    expect(environmentAllowsConnector(null, 'c')).toBe(true)
    expect(environmentAllowsConnector({ environmentSnapshot: '{"mcpPolicy":{"blockedConnectors":["c"]}}' }, 'c')).toBe(
      false,
    )
    expect(environmentAllowsConnector({ environmentSnapshot: '{"mcpPolicy":{"defaultEffect":"deny"}}' }, 'c')).toBe(
      false,
    )
  })
})

describe('[spec: governance/sandbox-restrictions] sandboxOperationForRuntimeTool', () => {
  it('maps sandbox.exec to a command op and sandbox.fetch to a network op', () => {
    expect(sandboxOperationForRuntimeTool('sandbox.exec', { command: 'ls -la' })).toEqual({
      operation: 'command',
      command: 'ls -la',
      resourceType: 'sandbox_command',
      resourceId: 'ls',
    })
    expect(sandboxOperationForRuntimeTool('sandbox.fetch', { url: 'https://api.example.com/x' })).toEqual({
      operation: 'network',
      host: 'api.example.com',
      resourceType: 'sandbox_network',
      resourceId: 'api.example.com',
    })
    expect(sandboxOperationForRuntimeTool('other.tool', {})).toBeNull()
  })
})

describe('[spec: governance/sandbox-restrictions] evaluateSandboxRuntimeDecision', () => {
  it('denies when sandbox is disabled', () => {
    expect(evaluateSandboxRuntimeDecision({ enabled: false }, null, { operation: 'command', command: 'ls' }).rule).toBe(
      'sandboxPolicy.enabled',
    )
  })

  it('blocks network when governance network is off or host is not allowed', () => {
    expect(evaluateSandboxRuntimeDecision({ network: 'deny' }, null, { operation: 'network', host: 'x' }).rule).toBe(
      'sandboxPolicy.network',
    )
    expect(
      evaluateSandboxRuntimeDecision({ allowedHosts: ['ok.com'] }, null, { operation: 'network', host: 'bad.com' })
        .rule,
    ).toBe('sandboxPolicy.allowedHosts')
    expect(
      evaluateSandboxRuntimeDecision({ allowedHosts: ['ok.com'] }, null, { operation: 'network', host: 'ok.com' })
        .allowed,
    ).toBe(true)
  })

  it('blocks commands by block list and gates by allow list', () => {
    expect(
      evaluateSandboxRuntimeDecision({ blockedCommands: ['rm'] }, null, { operation: 'command', command: 'rm -rf /' })
        .rule,
    ).toBe('sandboxPolicy.blockedCommands')
    expect(
      evaluateSandboxRuntimeDecision({ allowedCommands: ['ls'] }, null, { operation: 'command', command: 'cat x' })
        .rule,
    ).toBe('sandboxPolicy.allowedCommands')
    expect(
      evaluateSandboxRuntimeDecision({ allowedCommands: ['ls'] }, null, { operation: 'command', command: 'ls -la' })
        .allowed,
    ).toBe(true)
  })

  it('applies the session environment network policy restricted mode', () => {
    const session = {
      environmentSnapshot: '{"networkPolicy":{"mode":"restricted","allowedHosts":["ok.com"]}}',
    }
    expect(evaluateSandboxRuntimeDecision({}, session, { operation: 'network', host: 'bad.com' }).rule).toBe(
      'environment.networkPolicy.allowedHosts',
    )
    expect(evaluateSandboxRuntimeDecision({}, session, { operation: 'network', host: 'ok.com' }).allowed).toBe(true)
  })
})
