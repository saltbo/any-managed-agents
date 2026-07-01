import { describe, expect, it } from 'vitest'
import {
  AMA_SESSION_EVENT_TYPES,
  amaSessionEventTypeFromPayload,
  isAmaSessionEventType,
  normalizeAmaEvent,
  type AmaEvent,
} from './session-events'

describe('isAmaSessionEventType', () => {
  it('returns true for every canonical AMA event type', () => {
    for (const type of AMA_SESSION_EVENT_TYPES) {
      expect(isAmaSessionEventType(type)).toBe(true)
    }
  })

  it('returns false for unknown or empty strings', () => {
    expect(isAmaSessionEventType('not_a_real_type')).toBe(false)
    expect(isAmaSessionEventType('')).toBe(false)
  })
})

describe('amaSessionEventTypeFromPayload', () => {
  it('returns the type field when it is a non-empty string', () => {
    expect(amaSessionEventTypeFromPayload({ type: 'agent.started' })).toBe('agent.started')
  })

  it('returns unknown when type is missing, empty, or not a string', () => {
    expect(amaSessionEventTypeFromPayload({})).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({ type: '' })).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({ type: 42 })).toBe('unknown')
    expect(amaSessionEventTypeFromPayload({ type: null })).toBe('unknown')
  })
})

describe('normalizeAmaEvent', () => {
  it('keeps a canonical event shape without adding transport metadata', () => {
    const event: AmaEvent = { type: 'turn.completed', payload: {} }
    expect(normalizeAmaEvent(event)).toEqual({ type: 'turn.completed', payload: {} })
  })
})
