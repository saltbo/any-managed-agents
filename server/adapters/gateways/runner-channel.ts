import type { RunnerChannel } from '@server/usecases/ports'
import type { Env } from '../../env'

// Self-hosted runner session channels live in a per-session Durable Object.
// This gateway talks to that DO over its internal fetch protocol and never
// touches control-plane tables, so it is runtime infrastructure rather than the
// runners HTTP resource.
export function createRunnerChannel(env: Env): RunnerChannel {
  return {
    async isAccepted(sessionId: string): Promise<boolean> {
      const id = env.RUNNER_SESSION_CHANNEL.idFromName(sessionId)
      const stub = env.RUNNER_SESSION_CHANNEL.get(id)
      const response = await stub.fetch('https://runner-session-channel/status')
      if (!response.ok) {
        return false
      }
      const body = (await response.json()) as { active?: boolean }
      return body.active === true
    },

    async dispatch(sessionId: string, command: Record<string, unknown>): Promise<boolean> {
      const id = env.RUNNER_SESSION_CHANNEL.idFromName(sessionId)
      const stub = env.RUNNER_SESSION_CHANNEL.get(id)
      const response = await stub.fetch('https://runner-session-channel/dispatch', {
        method: 'POST',
        body: JSON.stringify(command),
      })
      return response.status === 202
    },
  }
}
