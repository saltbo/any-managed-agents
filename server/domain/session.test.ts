import { describe, expect, it } from 'vitest'
import {
  composeInitialPrompt,
  hasEmbeddedCredentialUrl,
  hasSecretMaterial,
  hostingModeFromSandbox,
  hostingModeFromSnapshot,
  mergeMetadataUpdate,
  normalizeMountPath,
  sessionAcceptsPrompts,
  sessionIsTerminal,
} from './session'

describe('[spec: sessions/state-rules] session state rules', () => {
  it('accepts prompts only while the runtime is live', () => {
    expect(sessionAcceptsPrompts('idle')).toBe(true)
    expect(sessionAcceptsPrompts('running')).toBe(true)
    expect(sessionAcceptsPrompts('pending')).toBe(false)
    expect(sessionAcceptsPrompts('stopped')).toBe(false)
    expect(sessionAcceptsPrompts('error')).toBe(false)
  })

  it('marks stopped and error as terminal', () => {
    expect(sessionIsTerminal('stopped')).toBe(true)
    expect(sessionIsTerminal('error')).toBe(true)
    expect(sessionIsTerminal('idle')).toBe(false)
  })
})

describe('hosting mode derivation', () => {
  it('derives cloud from a sandbox id and self-hosted from its absence', () => {
    expect(hostingModeFromSandbox('sandbox_1')).toBe('cloud')
    expect(hostingModeFromSandbox(null)).toBe('self_hosted')
  })

  it('derives self-hosted only for an explicit snapshot hosting mode', () => {
    expect(hostingModeFromSnapshot('self_hosted')).toBe('self_hosted')
    expect(hostingModeFromSnapshot('cloud')).toBe('cloud')
    expect(hostingModeFromSnapshot(undefined)).toBe('cloud')
  })
})

describe('[spec: sessions/workspace-safety] secret material detection', () => {
  it('flags secret-looking keys at any depth', () => {
    expect(hasSecretMaterial({ apiKey: 'x' })).toBe(true)
    expect(hasSecretMaterial({ nested: [{ password: 'x' }] })).toBe(true)
    expect(hasSecretMaterial({ plain: 'value' })).toBe(false)
  })

  it('flags urls carrying embedded credentials', () => {
    expect(hasEmbeddedCredentialUrl('https://user:pass@example.com')).toBe(true)
    expect(hasEmbeddedCredentialUrl('https://example.com')).toBe(false)
    expect(hasEmbeddedCredentialUrl({ url: 'https://u:p@h' })).toBe(true)
  })
})

describe('mergeMetadataUpdate', () => {
  it('merges set keys and removes keys set to null', () => {
    expect(mergeMetadataUpdate({ a: 1, b: 2 }, { b: null, c: 3 })).toEqual({ a: 1, c: 3 })
  })
})

describe('normalizeMountPath', () => {
  it('defaults to repos/owner/repo under /workspace', () => {
    expect(normalizeMountPath({ owner: 'saltbo', repo: 'ama' })).toBe('/workspace/repos/saltbo/ama')
  })

  it('rejects traversal and the reserved .ama root', () => {
    expect(() => normalizeMountPath({ owner: 'o', repo: 'r', mountPath: '../escape' })).toThrow()
    expect(() => normalizeMountPath({ owner: 'o', repo: 'r', mountPath: '.ama/x' })).toThrow()
  })

  it('rejects absolute paths outside /workspace', () => {
    expect(() => normalizeMountPath({ owner: 'o', repo: 'r', mountPath: '/etc/passwd' })).toThrow()
  })
})

describe('[spec: sessions/initial-prompt-compose] composeInitialPrompt', () => {
  it('returns the prompt unchanged when there is no memory', () => {
    expect(composeInitialPrompt(null, 'do the task')).toBe('do the task')
    expect(composeInitialPrompt('   ', 'do the task')).toBe('do the task')
  })

  it('prepends a memory block when memory is present', () => {
    const composed = composeInitialPrompt('remembered context', 'do the task')
    expect(composed).toContain('Agent memory for this agent:')
    expect(composed).toContain('remembered context')
    expect(composed).toContain('Current task:\ndo the task')
  })

  it('returns just the memory block when there is no prompt', () => {
    expect(composeInitialPrompt('remembered', undefined)).toBe('Agent memory for this agent:\nremembered')
  })
})
