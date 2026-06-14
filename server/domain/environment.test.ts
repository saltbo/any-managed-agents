import { describe, expect, it } from 'vitest'
import {
  hasSecretMaterial,
  mcpPolicyConnectorIds,
  RUNTIME_CONFIG_FIELDS,
  stringArray,
  validateSecretFreeObjects,
} from './environment'

describe('[spec: environments/secret-material] hasSecretMaterial', () => {
  it('flags objects with secret-suggesting keys', () => {
    expect(hasSecretMaterial({ apiKey: 'x' })).toBe(true)
    expect(hasSecretMaterial({ access_token: 'x' })).toBe(true)
    expect(hasSecretMaterial({ password: 'x' })).toBe(true)
    expect(hasSecretMaterial({ nested: { privateKey: 'x' } })).toBe(true)
  })

  it('passes secret-free objects', () => {
    expect(hasSecretMaterial({ owner: 'platform', count: 1 })).toBe(false)
    expect(hasSecretMaterial({})).toBe(false)
    expect(hasSecretMaterial(null)).toBe(false)
  })

  it('recurses through arrays', () => {
    expect(hasSecretMaterial([{ ok: 1 }, { secretValue: 'x' }])).toBe(true)
    expect(hasSecretMaterial([{ ok: 1 }])).toBe(false)
  })
})

describe('[spec: environments/secret-material] validateSecretFreeObjects', () => {
  const clean = { metadata: {}, mcpPolicy: {}, packageManagerPolicy: {}, runtimeConfig: {} }

  it('returns null when every object is secret-free', () => {
    expect(validateSecretFreeObjects(clean)).toBeNull()
  })

  it('keys the error to the offending field', () => {
    expect(validateSecretFreeObjects({ ...clean, metadata: { apiKey: 'x' } })).toEqual({
      metadata: expect.any(String),
    })
    expect(validateSecretFreeObjects({ ...clean, runtimeConfig: { npmToken: 'x' } })).toEqual({
      runtimeConfig: expect.any(String),
    })
    expect(validateSecretFreeObjects({ ...clean, mcpPolicy: { token: 'x' } })).toEqual({
      mcpPolicy: expect.any(String),
    })
    expect(validateSecretFreeObjects({ ...clean, packageManagerPolicy: { password: 'x' } })).toEqual({
      packageManagerPolicy: expect.any(String),
    })
  })
})

describe('[spec: environments/mcp-policy] mcpPolicyConnectorIds', () => {
  it('collects connectors across allow/block/approval lists and approval modes', () => {
    const ids = mcpPolicyConnectorIds({
      allowedConnectors: ['github'],
      blockedConnectors: ['linear'],
      requireApprovalConnectors: ['slack'],
      connectorApprovalModes: { jira: 'require_approval' },
    })
    expect(ids.sort()).toEqual(['github', 'jira', 'linear', 'slack'])
  })

  it('drops the wildcard and de-duplicates', () => {
    expect(mcpPolicyConnectorIds({ allowedConnectors: ['github', '*'], blockedConnectors: ['github'] })).toEqual([
      'github',
    ])
  })
})

describe('environment domain helpers', () => {
  it('stringArray keeps only strings', () => {
    expect(stringArray(['a', 1, 'b', null])).toEqual(['a', 'b'])
    expect(stringArray('nope')).toEqual([])
  })

  it('RUNTIME_CONFIG_FIELDS excludes name and description', () => {
    expect(RUNTIME_CONFIG_FIELDS).not.toContain('name')
    expect(RUNTIME_CONFIG_FIELDS).not.toContain('description')
    expect(RUNTIME_CONFIG_FIELDS).toContain('packages')
    expect(RUNTIME_CONFIG_FIELDS).toContain('networkPolicy')
  })
})
