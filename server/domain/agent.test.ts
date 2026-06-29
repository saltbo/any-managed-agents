import { describe, expect, it } from 'vitest'
import {
  type AgentToolAttachment,
  governanceBlocksTool,
  hasSecretMaterial,
  matchesHandoffTarget,
  mergeMetadata,
  nextVersionNumber,
  normalizeToolAttachments,
  validateConfigSecrets,
  validateHandoff,
  validateSkills,
  validateToolAttachments,
} from './agent'

function tool(partial: Partial<AgentToolAttachment> & { name: string }): AgentToolAttachment {
  return {
    description: null,
    inputSchema: {},
    approvalMode: 'project_policy',
    policyMetadata: {},
    ...partial,
  }
}

describe('[spec: agents/tool-contract] normalizeToolAttachments', () => {
  it('applies attachment defaults to sparse inputs', () => {
    expect(normalizeToolAttachments([{ name: 'repo.read' }])).toEqual([
      { name: 'repo.read', description: null, inputSchema: {}, approvalMode: 'project_policy', policyMetadata: {} },
    ])
  })

  it('preserves provided fields', () => {
    expect(
      normalizeToolAttachments([
        { name: 'web.search', description: 'Search', inputSchema: { a: 1 }, approvalMode: 'per_call' },
      ]),
    ).toEqual([
      {
        name: 'web.search',
        description: 'Search',
        inputSchema: { a: 1 },
        approvalMode: 'per_call',
        policyMetadata: {},
      },
    ])
  })
})

describe('[spec: agents/tool-contract] governanceBlocksTool', () => {
  it('blocks explicitly blocked tools and wildcards', () => {
    expect(governanceBlocksTool({ blockedTools: ['repo.delete'] }, 'repo.delete')).toBe(true)
    expect(governanceBlocksTool({ blockedTools: ['*'] }, 'anything')).toBe(true)
  })

  it('blocks tools outside a non-wildcard allowlist', () => {
    expect(governanceBlocksTool({ allowedTools: ['web.search'] }, 'repo.read')).toBe(true)
    expect(governanceBlocksTool({ allowedTools: ['web.search'] }, 'web.search')).toBe(false)
    expect(governanceBlocksTool({ allowedTools: ['*'] }, 'web.search')).toBe(false)
  })

  it('blocks when the default effect is deny', () => {
    expect(governanceBlocksTool({ defaultEffect: 'deny' }, 'web.search')).toBe(true)
    expect(governanceBlocksTool({}, 'web.search')).toBe(false)
  })
})

describe('[spec: agents/tool-contract] validateToolAttachments', () => {
  it('rejects duplicate tool names', () => {
    expect(validateToolAttachments([tool({ name: 'a' }), tool({ name: 'a' })], {})).toEqual({
      tools: 'Tool is attached more than once: a',
    })
  })

  it('rejects platform-blocked tools', () => {
    expect(validateToolAttachments([tool({ name: 'secrets.read' })], {})).toEqual({
      tools: 'Tool is blocked by policy: secrets.read',
    })
  })

  it('rejects policy-blocked tools', () => {
    expect(validateToolAttachments([tool({ name: 'repo.delete' })], { blockedTools: ['repo.delete'] })).toEqual({
      tools: 'Tool is blocked by policy: repo.delete',
    })
  })

  it('rejects secret material inside a tool', () => {
    expect(validateToolAttachments([tool({ name: 'repo.read', policyMetadata: { token: 'raw-secret' } })], {})).toEqual(
      { tools: 'Secret material must be stored in a vault.' },
    )
  })

  it('accepts a clean tool set', () => {
    expect(validateToolAttachments([tool({ name: 'web.search' }), tool({ name: 'repo.read' })], {})).toBeNull()
  })
})

describe('[spec: agents/validation] validateSkills', () => {
  it('requires a stable source@skill reference', () => {
    expect(validateSkills(['missing-style'])).toMatchObject({ skills: expect.stringContaining('stable') })
    expect(validateSkills(['ama@code review'])).toMatchObject({ skills: expect.any(String) })
    expect(validateSkills(['ama@code-review'])).toBeNull()
    expect(validateSkills(['saltbo/agent-kanban#codex/ama-runtime-integration@ak-maintainer'])).toBeNull()
    expect(validateSkills(['ama#@code-review'])).toMatchObject({ skills: expect.any(String) })
    expect(validateSkills(['ama#bad ref@code-review'])).toMatchObject({ skills: expect.any(String) })
  })

  it('rejects secret-looking skills', () => {
    expect(validateSkills(['ama@raw-secret-token'])).toEqual({
      skills: 'Secret material must be stored in a vault.',
    })
  })
})

describe('[spec: agents/validation] validateHandoff', () => {
  it('requires stable identifiers', () => {
    expect(
      validateHandoff({ enabled: true, accepts: { roles: ['has space'], capabilities: [] }, targets: [] }),
    ).toMatchObject({ handoff: expect.any(String) })
    expect(
      validateHandoff({
        enabled: true,
        accepts: { roles: ['maintainer'], capabilities: ['issue-triage', 'code-review'] },
        targets: [],
      }),
    ).toBeNull()
  })

  it('rejects handoff identifiers that look like secret material', () => {
    expect(
      validateHandoff({
        enabled: true,
        accepts: { roles: [], capabilities: ['raw-secret-value-xxxxxxxxxxxxxxxxx'] },
        targets: [],
      }),
    ).toEqual({
      handoff: 'Secret material must be stored in a vault.',
    })
  })
})

describe('[spec: agents/validation] hasSecretMaterial', () => {
  it('detects secret-looking values and keys at any depth', () => {
    expect(hasSecretMaterial({ access_token: 'raw-secret' })).toBe(true)
    expect(hasSecretMaterial({ nested: [{ secretValue: 'x' }] })).toBe(true)
    expect(hasSecretMaterial('ghp_0123456789abcdef0123456789abcdef')).toBe(true)
    expect(hasSecretMaterial({ owner: 'platform' })).toBe(false)
  })
})

describe('[spec: agents/validation] validateConfigSecrets', () => {
  const clean = { subagents: [], handoff: { enabled: false, accepts: { roles: [], capabilities: [] }, targets: [] } }

  it('flags the offending free-form field', () => {
    expect(
      validateConfigSecrets({
        ...clean,
        handoff: { enabled: true, accepts: { roles: [], capabilities: [] }, targets: [{ capability: 'raw-secret' }] },
      }),
    ).toEqual({
      handoff: 'Secret material must be stored in a vault.',
    })
  })

  it('flags secret material in subagents array', () => {
    expect(validateConfigSecrets({ ...clean, subagents: [{ token: 'raw-secret' }] })).toEqual({
      subagents: 'Secret material must be stored in a vault.',
    })
  })

  it('passes a clean config', () => {
    expect(validateConfigSecrets(clean)).toBeNull()
  })
})

describe('[spec: agents/lifecycle] mergeMetadata', () => {
  it('overwrites present keys and drops keys set to null', () => {
    expect(mergeMetadata({ owner: 'platform', remove: 'stale' }, { owner: 'runtime', remove: null })).toEqual({
      owner: 'runtime',
    })
  })

  it('returns current unchanged when no update', () => {
    expect(mergeMetadata({ owner: 'platform' }, undefined)).toEqual({ owner: 'platform' })
  })
})

describe('[spec: agents/lifecycle] nextVersionNumber', () => {
  it('starts at 1 and increments', () => {
    expect(nextVersionNumber(null)).toBe(1)
    expect(nextVersionNumber(3)).toBe(4)
  })
})

describe('[spec: agents/handoff] handoff target resolution', () => {
  it('matches a candidate by role or capability', () => {
    const candidate = {
      role: 'worker',
      handoff: { enabled: true, accepts: { roles: [], capabilities: ['implementation'] }, targets: [] },
    }
    expect(matchesHandoffTarget([{ role: 'worker' }], candidate)).toBe(true)
    expect(matchesHandoffTarget([{ capability: 'implementation' }], candidate)).toBe(true)
    expect(matchesHandoffTarget([{ role: 'reviewer' }], candidate)).toBe(false)
  })
})
