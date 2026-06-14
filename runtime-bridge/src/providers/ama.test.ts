import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionInput } from '../../../runtime-core/ports'
import { runLocalTool } from './ama'

function fetchInput(url: string): ToolExecutionInput {
  return {
    sessionId: 'session_1',
    sandboxId: 'session_1',
    toolCallId: 'call_1',
    toolName: 'sandbox.fetch',
    input: { url },
  }
}

function streamingBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
        return
      }
      controller.close()
    },
  })
}

describe('runLocalTool sandbox.fetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('caps an oversized body to MAX_FETCH_BYTES and forwards a signal', async () => {
    // 6 chunks of 1MB each = 6MB body, exceeding the 5MB cap.
    const chunk = new TextEncoder().encode('a'.repeat(1_000_000))
    const chunks = Array.from({ length: 6 }, () => chunk)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(streamingBody(chunks), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runLocalTool('/workspace', fetchInput('https://example.com/big'))

    expect(result.status).toBe(200)
    expect((result.content as string).length).toBe(5_000_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/big',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('combines the turn signal with the fetch timeout signal', async () => {
    let captured: AbortSignal | null | undefined
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      captured = init?.signal
      return new Response('ok', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const result = await runLocalTool('/workspace', fetchInput('https://example.com/ok'), controller.signal)

    expect(result).toEqual({ status: 200, content: 'ok' })
    expect(captured).toBeInstanceOf(AbortSignal)

    // The combined signal aborts when the turn signal aborts.
    controller.abort()
    expect(captured?.aborted).toBe(true)
  })
})
