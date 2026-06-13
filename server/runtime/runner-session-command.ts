import type { Env } from '../env'

// Self-hosted runner session channels live in a per-session Durable Object.
// Both helpers talk to that DO over its internal fetch protocol and never touch
// control-plane tables, so they are runtime infrastructure rather than the
// runners HTTP resource. Their signatures are part of the cross-domain contract
// (consumed by app.ts and the sessions domain) and must not change.

export async function hasAcceptedRunnerSessionChannel(env: Env, sessionId: string) {
  const id = env.RUNNER_SESSION_CHANNEL.idFromName(sessionId)
  const stub = env.RUNNER_SESSION_CHANNEL.get(id)
  const response = await stub.fetch('https://runner-session-channel/status')
  if (!response.ok) {
    return false
  }
  const body = (await response.json()) as { active?: boolean }
  return body.active === true
}

export async function dispatchRunnerSessionCommand(env: Env, sessionId: string, command: Record<string, unknown>) {
  const id = env.RUNNER_SESSION_CHANNEL.idFromName(sessionId)
  const stub = env.RUNNER_SESSION_CHANNEL.get(id)
  const response = await stub.fetch('https://runner-session-channel/dispatch', {
    method: 'POST',
    body: JSON.stringify(command),
  })
  return response.status === 202
}
