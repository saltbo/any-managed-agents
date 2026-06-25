import { describe, expect, it } from 'vitest'
import { hasSecretMaterial, nextDueFromInterval, PromptTemplateRenderError, renderHttpPromptTemplate } from './trigger'

describe('nextDueFromInterval', () => {
  it('computes the next due date from a given timestamp', () => {
    const from = new Date('2026-01-01T00:00:00.000Z').getTime()
    expect(nextDueFromInterval(3600, from)).toBe('2026-01-01T01:00:00.000Z')
  })

  it('uses the current time as default when no from is provided', () => {
    const before = Date.now()
    const result = nextDueFromInterval(60)
    const after = Date.now()
    const resultMs = new Date(result).getTime()
    expect(resultMs).toBeGreaterThanOrEqual(before + 60 * 1000)
    expect(resultMs).toBeLessThanOrEqual(after + 60 * 1000)
  })
})

describe('hasSecretMaterial', () => {
  it('returns false for null, undefined, and non-object primitives', () => {
    expect(hasSecretMaterial(null)).toBe(false)
    expect(hasSecretMaterial(undefined)).toBe(false)
    expect(hasSecretMaterial(42)).toBe(false)
    expect(hasSecretMaterial('plain-string')).toBe(false)
  })

  it('returns false for empty objects and safe objects', () => {
    expect(hasSecretMaterial({})).toBe(false)
    expect(hasSecretMaterial({ owner: 'platform' })).toBe(false)
  })

  it('detects secret-looking keys at the top level', () => {
    expect(hasSecretMaterial({ secret: 'x' })).toBe(true)
    expect(hasSecretMaterial({ token: 'x' })).toBe(true)
    expect(hasSecretMaterial({ apikey: 'x' })).toBe(true)
    expect(hasSecretMaterial({ password: 'x' })).toBe(true)
    expect(hasSecretMaterial({ privatekey: 'x' })).toBe(true)
  })

  it('detects secret-looking keys nested in arrays', () => {
    expect(hasSecretMaterial([{ ok: 1 }, { token: 'x' }])).toBe(true)
    expect(hasSecretMaterial([{ ok: 1 }])).toBe(false)
  })

  it('detects secret-looking keys at any depth in nested objects', () => {
    expect(hasSecretMaterial({ nested: { deep: { secret: 'x' } } })).toBe(true)
    expect(hasSecretMaterial({ nested: { deep: { safe: 'ok' } } })).toBe(false)
  })
})

describe('renderHttpPromptTemplate', () => {
  it('renders body, query, and header variables', () => {
    const prompt = renderHttpPromptTemplate(
      'Handle {{ body.ticket.id }} for {{ query.team }} via {{ headers.x-source }}.',
      {
        body: { ticket: { id: 'T-123' } },
        query: { team: 'support' },
        headers: { 'x-source': 'webhook' },
      },
    )
    expect(prompt).toBe('Handle T-123 for support via webhook.')
  })

  it('stringifies object values when a path resolves to an object', () => {
    const prompt = renderHttpPromptTemplate('Payload: {{ body.payload }}', {
      body: { payload: { ok: true } },
      query: {},
      headers: {},
    })
    expect(prompt).toBe('Payload: {"ok":true}')
  })

  it('renders array, null, number, and boolean values', () => {
    const prompt = renderHttpPromptTemplate('{{ body.items.1 }} {{ body.none }} {{ body.count }} {{ body.ok }}', {
      body: { items: ['first', 'second'], none: null, count: 3, ok: false },
      query: {},
      headers: {},
    })
    expect(prompt).toBe('second  3 false')
  })

  it('fails when a variable is missing', () => {
    expect(() => renderHttpPromptTemplate('Handle {{ body.ticket.id }}', { body: {}, query: {}, headers: {} })).toThrow(
      PromptTemplateRenderError,
    )
  })

  it('fails when a variable reads an unsupported root', () => {
    expect(() => renderHttpPromptTemplate('Handle {{ secrets.token }}', { body: {}, query: {}, headers: {} })).toThrow(
      PromptTemplateRenderError,
    )
  })

  it('fails when a variable path segment is invalid', () => {
    expect(() =>
      renderHttpPromptTemplate('Handle {{ body.ticket["id"] }}', { body: {}, query: {}, headers: {} }),
    ).toThrow(PromptTemplateRenderError)
  })

  it('propagates unexpected read errors', () => {
    const body = {}
    Object.defineProperty(body, 'ticket', {
      get() {
        throw new Error('getter failed')
      },
    })
    expect(() => renderHttpPromptTemplate('Handle {{ body.ticket.id }}', { body, query: {}, headers: {} })).toThrow(
      'getter failed',
    )
  })
})
