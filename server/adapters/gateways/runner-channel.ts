import type { RunnerChannel } from '@server/usecases/ports'
import type { Env } from '../../env'

// Self-hosted runner session channels live in a Session Durable Object. This
// gateway talks to that DO over its internal fetch protocol and never touches
// control-plane tables, so it is runtime infrastructure rather than the runners
// HTTP resource. The DO instance is resolved per session: a CLI relay session
// routes to its per-runner instance (idFromName(runnerId)), shared across the
// runner's sessions, so a command reaches the live runner channel even after the
// session's own lease ended. `resolveDoName` (injected at composition) owns that
// session→instance mapping; the command always carries its sessionId in the body.
export function createRunnerChannel(env: Env, resolveDoName: (sessionId: string) => Promise<string>): RunnerChannel {
  return {
    async isAccepted(sessionId: string): Promise<boolean> {
      const stub = env.SESSION.get(env.SESSION.idFromName(await resolveDoName(sessionId)))
      const response = await stub.fetch('https://session-object/status')
      if (!response.ok) {
        return false
      }
      const body = (await response.json()) as { active?: boolean }
      return body.active === true
    },

    async dispatch(sessionId: string, command: Record<string, unknown>): Promise<boolean> {
      const stub = env.SESSION.get(env.SESSION.idFromName(await resolveDoName(sessionId)))
      // The DO routes the command by sessionId: the per-runner channel multiplexes
      // many sessions, so the target rides in the body alongside the command.
      const response = await stub.fetch('https://session-object/dispatch', {
        method: 'POST',
        body: JSON.stringify({ sessionId, command }),
      })
      return response.status === 202
    },
  }
}
