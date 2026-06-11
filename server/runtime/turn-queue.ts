import type { Env } from '../env'

// Cloud session turns run from a queue consumer instead of HTTP waitUntil:
// a turn that shells out (installs, builds, sleeps) outlives the request
// lifetime cap and was silently killed mid-exec, stranding the session in
// "running". The consumer invocation owns the full turn wall-clock budget.
export type CloudTurnMessage = {
  type: 'session.turn'
  sessionId: string
  organizationId: string
  projectId: string
  prompt: string
  auditAction: 'session.initial_prompt' | 'session.command'
}

// Test mode (and local setups without the queue binding) run turns inline so
// existing synchronous semantics and assertions keep working.
export function cloudTurnsRunInline(env: Env): boolean {
  return env.AMA_RUNTIME_MODE === 'test' || !env.CLOUD_TURNS
}

export async function enqueueCloudTurn(env: Env, message: CloudTurnMessage): Promise<void> {
  if (!env.CLOUD_TURNS) {
    throw new Error('CLOUD_TURNS queue binding is not configured')
  }
  await env.CLOUD_TURNS.send(message)
}
