import { describe, expect, it } from 'vitest'
import { runtimeMessagesFromEvents } from './transcript'

describe('runtime-core transcript', () => {
  it('prefers the latest agent_end snapshot over accumulated message_end', () => {
    const messages = runtimeMessagesFromEvents([
      { payload: { type: 'message_end', message: { role: 'user', content: 'stale fallback' } } },
      {
        payload: {
          type: 'agent_end',
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

  it('falls back to message_end accumulation when no agent_end is present', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message_update', payload: { message: { role: 'assistant', content: 'partial' } } },
      { type: 'message_end', payload: { message: { role: 'assistant', content: 'completed' } } },
    ])
    expect(messages).toEqual([{ role: 'assistant', content: 'completed' }])
  })

  it('skips malformed payload entries instead of throwing', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message_end', payload: 'not json {' },
      { type: 'message_end', payload: JSON.stringify({ message: { role: 'user', content: 'kept' } }) },
    ])
    expect(messages).toEqual([{ role: 'user', content: 'kept' }])
  })

  it('parses string payloads and ignores non-persisted message roles', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message_end', payload: JSON.stringify({ message: { role: 'system', content: 'ignored' } }) },
      { type: 'message_end', payload: JSON.stringify({ message: { role: 'assistant', content: 'kept' } }) },
    ])
    expect(messages).toEqual([{ role: 'assistant', content: 'kept' }])
  })
})
