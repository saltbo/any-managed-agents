import { describe, expect, it } from 'vitest'
import {
  composeInitialPrompt,
  hasEmbeddedCredentialUrl,
  hasSecretMaterial,
  hostingModeFromSandbox,
  hostingModeFromSnapshot,
  mergeSessionUserMetadata,
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

describe('mergeSessionUserMetadata', () => {
  it('merges labels and annotations without disturbing runtime metadata', () => {
    expect(
      mergeSessionUserMetadata(
        { runtime: 'ama', labels: { lane: 'old' }, annotations: { keep: 'yes', remove: 'old' } },
        { labels: { lane: 'new' }, remove: null, ticket: 'AMA-1' },
      ),
    ).toEqual({
      runtime: 'ama',
      labels: { lane: 'new' },
      annotations: { keep: 'yes', ticket: 'AMA-1' },
    })
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

describe('[spec: sessions/workspace-safety] hasEmbeddedCredentialUrl additional branches', () => {
  it('returns false for an invalid URL string (parse error)', () => {
    expect(hasEmbeddedCredentialUrl('not-a-url::bad')).toBe(false)
  })

  it('returns false for null and non-object primitives', () => {
    expect(hasEmbeddedCredentialUrl(null)).toBe(false)
    expect(hasEmbeddedCredentialUrl(42)).toBe(false)
    expect(hasEmbeddedCredentialUrl(false)).toBe(false)
  })

  it('recurses through arrays of values', () => {
    expect(hasEmbeddedCredentialUrl(['https://u:p@host', 'https://ok.com'])).toBe(true)
    expect(hasEmbeddedCredentialUrl(['https://ok.com', 'plain'])).toBe(false)
  })
})

describe('[spec: sessions/workspace-safety] normalizeMountPath additional branches', () => {
  it('rejects paths containing control characters', () => {
    expect(() => normalizeMountPath({ owner: 'o', repo: 'r', mountPath: 'path\x00with-null' })).toThrow(
      'Mount path contains invalid characters.',
    )
  })

  it('rejects mount path segments with special characters', () => {
    expect(() => normalizeMountPath({ owner: 'o', repo: 'r', mountPath: 'a/b@c' })).toThrow(
      'Mount path segments may contain only letters, numbers, dots, underscores, and hyphens.',
    )
  })

  it('accepts an absolute /workspace/ path', () => {
    expect(normalizeMountPath({ owner: 'o', repo: 'r', mountPath: '/workspace/my-repo' })).toBe('/workspace/my-repo')
  })

  it('rejects a path with empty segments from double-slash', () => {
    expect(() => normalizeMountPath({ owner: 'o', repo: 'r', mountPath: 'a//b' })).toThrow()
  })

  it('rejects a path with a dot segment', () => {
    expect(() => normalizeMountPath({ owner: 'o', repo: 'r', mountPath: 'a/./b' })).toThrow()
  })
})
