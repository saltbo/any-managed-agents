import { describe, expect, it } from 'vitest'
import { connectionRequestTimeoutMs, connectorPolicyEffect, credentialRef, disconnectedAtFor } from './connection'

describe('[spec: connections/policy] [spec: mcp/policy-effect] connectorPolicyEffect', () => {
  it('allows by default', () => {
    expect(connectorPolicyEffect({}, 'github')).toBe('allowed')
  })

  it('blocks an explicitly blocked connector and a wildcard block', () => {
    expect(connectorPolicyEffect({ blockedConnectors: ['github'] }, 'github')).toBe('blocked')
    expect(connectorPolicyEffect({ blockedConnectors: ['*'] }, 'github')).toBe('blocked')
  })

  it('blocks a connector absent from a non-empty allow list', () => {
    expect(connectorPolicyEffect({ allowedConnectors: ['linear'] }, 'github')).toBe('blocked')
    expect(connectorPolicyEffect({ allowedConnectors: ['github'] }, 'github')).toBe('allowed')
  })

  it('requires approval for required connectors', () => {
    expect(connectorPolicyEffect({ requireApprovalConnectors: ['github'] }, 'github')).toBe('approval_required')
  })

  it('blocks under defaultEffect deny', () => {
    expect(connectorPolicyEffect({ defaultEffect: 'deny' }, 'github')).toBe('blocked')
  })
})

describe('[spec: connections/timeout] connectionRequestTimeoutMs', () => {
  it('defaults when no override is present', () => {
    expect(connectionRequestTimeoutMs({})).toBe(20_000)
  })

  it('clamps to the safe range', () => {
    expect(connectionRequestTimeoutMs({ requestTimeoutMs: 50 })).toBe(100)
    expect(connectionRequestTimeoutMs({ requestTimeoutMs: 999_999 })).toBe(60_000)
    expect(connectionRequestTimeoutMs({ requestTimeoutMs: 5000 })).toBe(5000)
  })
})

describe('[spec: connections/credential-ref] credentialRef', () => {
  it('returns null when no credential is configured', () => {
    expect(credentialRef({ credentialId: null, credentialVersionId: null })).toBeNull()
  })

  it('omits versionId when unpinned and includes it when pinned', () => {
    expect(credentialRef({ credentialId: 'cred_1', credentialVersionId: null })).toEqual({ credentialId: 'cred_1' })
    expect(credentialRef({ credentialId: 'cred_1', credentialVersionId: 'ver_1' })).toEqual({
      credentialId: 'cred_1',
      versionId: 'ver_1',
    })
  })
})

describe('[spec: connections/state] disconnectedAtFor', () => {
  it('stamps a timestamp on disconnect and clears it on reconnect', () => {
    expect(disconnectedAtFor('disconnected', 'T1', null)).toBe('T1')
    expect(disconnectedAtFor('connected', 'T1', 'T0')).toBeNull()
    expect(disconnectedAtFor('disabled', 'T1', 'T0')).toBe('T0')
    expect(disconnectedAtFor(undefined, 'T1', 'T0')).toBe('T0')
  })
})
