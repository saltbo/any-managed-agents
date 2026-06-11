import { describe, expect, it } from 'vitest'
import { createAsyncPushQueue, createResumeTokenWatcher } from './protocol'

describe('createResumeTokenWatcher', () => {
  it('emits the resume token as soon as the handle learns it', () => {
    let token: string | undefined
    const emitted: string[] = []
    const check = createResumeTokenWatcher({ getResumeToken: () => token }, (value) => emitted.push(value))

    check()
    expect(emitted).toEqual([])

    token = 'thread_1'
    check()
    expect(emitted).toEqual(['thread_1'])
  })

  it('deduplicates unchanged tokens and emits again when the token rotates', () => {
    let token: string | undefined = 'session_a'
    const emitted: string[] = []
    const check = createResumeTokenWatcher({ getResumeToken: () => token }, (value) => emitted.push(value))

    check()
    check()
    expect(emitted).toEqual(['session_a'])

    token = 'session_b'
    check()
    check()
    expect(emitted).toEqual(['session_a', 'session_b'])
  })

  it('supports handles without resume tokens', () => {
    const emitted: string[] = []
    const check = createResumeTokenWatcher({}, (value) => emitted.push(value))
    check()
    expect(emitted).toEqual([])
  })
})

describe('createAsyncPushQueue', () => {
  it('yields values pushed before and after iteration starts, then ends', async () => {
    const queue = createAsyncPushQueue<string>()
    queue.push('first')

    const received: string[] = []
    const consumed = (async () => {
      for await (const value of queue.values) {
        received.push(value)
      }
    })()

    await Promise.resolve()
    queue.push('second')
    queue.push('third')
    queue.end()
    await consumed

    expect(received).toEqual(['first', 'second', 'third'])
  })

  it('drains pending values queued before end', async () => {
    const queue = createAsyncPushQueue<number>()
    queue.push(1)
    queue.push(2)
    queue.end()

    const received: number[] = []
    for await (const value of queue.values) {
      received.push(value)
    }
    expect(received).toEqual([1, 2])
  })
})
