import { describe, expect, it } from 'vitest'
import { buildRedactedRunnerCanonicalEvent } from './runner-session-channel'

const channel = {
  channelId: 'channel_1',
  runnerId: 'runner_1',
  leaseId: 'lease_1',
  workItemId: 'work_1',
}

describe('[spec: runtime/runner-channel] runner event redaction on persist', () => {
  it('scrubs secret-shaped values from an untrusted runner event payload before it is persisted', () => {
    const canonical = buildRedactedRunnerCanonicalEvent(
      channel,
      {
        type: 'runtime.metadata',
        payload: {
          apiKey: 'sk-live-should-be-scrubbed',
          message: 'authorization: Bearer abc123',
          detail: 'plain text',
        },
      },
      {},
    )

    expect(canonical.payload.data).toMatchObject({
      apiKey: '[REDACTED]',
      message: '[REDACTED]',
      // Non-secret fields stay intact.
      detail: 'plain text',
    })
  })

  it('scrubs secret-shaped values from runner-emitted metadata while keeping channel context', () => {
    const canonical = buildRedactedRunnerCanonicalEvent(
      channel,
      {
        type: 'runtime.metadata',
        payload: { ok: true },
        metadata: { accessToken: 'raw-token-value', source: 'runner' },
      },
      {},
    )

    expect(canonical.metadata.accessToken).toBe('[REDACTED]')
    expect(canonical.metadata.channelId).toBe('channel_1')
    expect(canonical.metadata.runnerId).toBe('runner_1')
  })
})
