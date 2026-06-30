import { describe, expect, it } from 'vitest'
import {
  composePrompt,
  hasEmbeddedCredentialUrl,
  hasSecretMaterial,
  hostingModeFromSandbox,
  hostingModeFromSnapshot,
  mergeSessionUserMetadata,
  sessionAcceptsPrompts,
  sessionEventVisibility,
  sessionIsTerminal,
  sessionUserMetadata,
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
    expect(hasSecretMaterial({ secretRef: 'ama://vaults/vault_1/credentials/token/versions/ver_1' })).toBe(false)
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

  it('handles direct labels, annotations, deletes, and ignored non-strings', () => {
    expect(
      sessionUserMetadata({
        labels: { team: 'runtime', ignored: 1 },
        annotations: { note: 'keep', ignored: false },
        ticket: 'AMA-1',
        count: 2,
        nullable: null,
      }),
    ).toEqual({ labels: { team: 'runtime' }, annotations: { note: 'keep', ticket: 'AMA-1' } })

    expect(
      mergeSessionUserMetadata(
        { labels: { keep: 'yes', remove: 'old' }, annotations: { keep: 'yes', remove: 'old' } },
        { labels: { remove: null, add: 'new' }, annotations: { remove: null, add: 'new' }, keep: null },
      ),
    ).toEqual({ labels: { keep: 'yes', add: 'new' }, annotations: { add: 'new' } })
  })
})

describe('sessionEventVisibility', () => {
  it('accepts known visibility values and rejects invalid values', () => {
    expect(sessionEventVisibility('runtime')).toBe('runtime')
    expect(sessionEventVisibility('transcript')).toBe('transcript')
    expect(sessionEventVisibility('debug')).toBe('debug')
    expect(sessionEventVisibility('audit')).toBe('audit')
    expect(() => sessionEventVisibility('public')).toThrow('Invalid session event visibility')
  })
})

describe('[spec: sessions/initial-prompt-compose] composePrompt', () => {
  it('returns the prompt unchanged when there is no memory', () => {
    expect(composePrompt(null, 'do the task')).toBe('do the task')
    expect(composePrompt('   ', 'do the task')).toBe('do the task')
  })

  it('prepends a memory block when memory is present', () => {
    const composed = composePrompt('remembered context', 'do the task')
    expect(composed).toContain('Agent memory for this agent:')
    expect(composed).toContain('remembered context')
    expect(composed).toContain('Current task:\ndo the task')
  })

  it('keeps the required prompt when memory is present', () => {
    expect(composePrompt('remembered', 'do it')).toBe(
      'Agent memory for this agent:\nremembered\n\nCurrent task:\ndo it',
    )
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
