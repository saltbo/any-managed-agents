import type { RunnerChannel } from '@server/usecases/ports'
import type { Env } from '../../env'

// Self-hosted runner session channels live in a per-session Durable Object.
// This gateway talks to that DO over its internal fetch protocol and never
// touches control-plane tables, so it is runtime infrastructure rather than the
// runners HTTP resource.
export function createRunnerChannel(env: Env): RunnerChannel {
  return {
    async isAccepted(sessionId: string): Promise<boolean> {
      const id = env.SESSION.idFromName(sessionId)
      const stub = env.SESSION.get(id)
      const response = await stub.fetch('https://session-object/status')
      if (!response.ok) {
        return false
      }
      const body = (await response.json()) as { active?: boolean }
      return body.active === true
    },

    async dispatch(sessionId: string, command: Record<string, unknown>): Promise<boolean> {
      const id = env.SESSION.idFromName(sessionId)
      const stub = env.SESSION.get(id)
      const response = await stub.fetch('https://session-object/dispatch', {
        method: 'POST',
        body: JSON.stringify(command),
      })
      return response.status === 202
    },
  }
}
