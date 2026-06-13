import { describe, expect, it } from 'vitest'
import { DEFAULT_CONNECTORS, PLATFORM_CONNECTOR_IDS, requiresVaultCredential } from './connector'

describe('[spec: connectors/catalog] [spec: mcp/catalog] platform catalog', () => {
  it('exposes the seeded connector ids', () => {
    expect(PLATFORM_CONNECTOR_IDS).toEqual(['github', 'linear'])
  })

  it('every catalog entry is available and carries at least one tool', () => {
    for (const connector of DEFAULT_CONNECTORS) {
      expect(connector.availability).toBe('available')
      expect(connector.tools.length).toBeGreaterThan(0)
    }
  })
})

describe('[spec: connectors/auth] requiresVaultCredential', () => {
  it('is true when vault_credential is a supported auth mode', () => {
    expect(requiresVaultCredential(['vault_credential'])).toBe(true)
    expect(requiresVaultCredential(['oauth'])).toBe(false)
    expect(requiresVaultCredential([])).toBe(false)
  })
})
