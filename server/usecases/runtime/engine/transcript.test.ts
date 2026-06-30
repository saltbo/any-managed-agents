import { describe, expect, it } from 'vitest'
import { runtimeMessagesFromEvents } from './transcript'

describe('AMA runtime transcript', () => {
  it('prefers the latest agent.completed snapshot over accumulated message.completed', () => {
    const messages = runtimeMessagesFromEvents([
      { payload: { type: 'message.completed', message: { role: 'user', content: 'stale fallback' } } },
      {
        payload: {
          type: 'agent.completed',
          messages: [
            { role: 'user', content: 'canonical user' },
            { role: 'assistant', content: 'canonical assistant' },
          ],
        },
      },
    ])
    expect(messages).toEqual([
      { role: 'user', content: 'canonical user' },
      { role: 'assistant', content: 'canonical assistant' },
    ])
  })

  it('falls back to message.completed accumulation when no agent.completed is present', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message.updated', payload: { message: { role: 'assistant', content: 'partial' } } },
      { type: 'message.completed', payload: { message: { role: 'assistant', content: 'completed' } } },
    ])
    expect(messages).toEqual([{ role: 'assistant', content: 'completed' }])
  })

  it('skips malformed payload entries instead of throwing', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message.completed', payload: 'not json {' },
      { type: 'message.completed', payload: JSON.stringify({ message: { role: 'user', content: 'kept' } }) },
    ])
    expect(messages).toEqual([{ role: 'user', content: 'kept' }])
  })

  it('parses string payloads and ignores non-persisted message roles', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message.completed', payload: JSON.stringify({ message: { role: 'system', content: 'ignored' } }) },
      { type: 'message.completed', payload: JSON.stringify({ message: { role: 'assistant', content: 'kept' } }) },
    ])
    expect(messages).toEqual([{ role: 'assistant', content: 'kept' }])
  })
})
