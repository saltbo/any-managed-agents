import { createRunnerChannel } from '../adapters/gateways/runner-channel'
import type { Env } from '../env'

// Shim: the runner session channel DO protocol now lives in the gateway adapter
// (adapters/gateways/runner-channel). These env-taking helpers keep their
// signatures (consumed by app.ts and the sessions domain) and delegate to the
// adapter so current callers are unchanged.

export async function hasAcceptedRunnerSessionChannel(env: Env, sessionId: string) {
  return createRunnerChannel(env).isAccepted(sessionId)
}

export async function dispatchRunnerSessionCommand(env: Env, sessionId: string, command: Record<string, unknown>) {
  return createRunnerChannel(env).dispatch(sessionId, command)
}
