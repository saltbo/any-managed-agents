import { describe, expect, it } from 'vitest'
import { hasSecretMaterial, RUNTIME_CONFIG_FIELDS, stringArray } from './environment'

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

describe('environment domain helpers', () => {
  it('stringArray keeps only strings', () => {
    expect(stringArray(['a', 1, 'b', null])).toEqual(['a', 'b'])
    expect(stringArray('nope')).toEqual([])
  })

  it('RUNTIME_CONFIG_FIELDS excludes name and description', () => {
    expect(RUNTIME_CONFIG_FIELDS).not.toContain('name')
    expect(RUNTIME_CONFIG_FIELDS).not.toContain('description')
    expect(RUNTIME_CONFIG_FIELDS).toContain('packages')
    expect(RUNTIME_CONFIG_FIELDS).toContain('networking')
  })
})
