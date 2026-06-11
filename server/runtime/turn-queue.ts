import type { Env } from '../env'

// Cloud session work runs from a queue consumer instead of HTTP waitUntil:
// a turn that shells out (installs, builds, sleeps) or a sandbox cold boot
// outlives the request lifetime cap and was silently killed mid-flight,
// stranding the session. The consumer invocation owns the wall-clock budget.
export type CloudSessionTurnMessage = {
  type: 'session.turn'
  sessionId: string
  organizationId: string
  projectId: string
  prompt: string
  auditAction: 'session.initial_prompt' | 'session.command'
}

export type CloudSessionStartMessage = {
  type: 'session.start'
  sessionId: string
  organizationId: string
  projectId: string
  runtime: string
  runtimeConfig: Record<string, unknown>
  resourceRefs: Array<Record<string, unknown>>
  runtimeEnv: Record<string, string>
  runtimeSecretEnv: Array<{ name: string; ref: string }>
  initialPrompt?: string
}

export type CloudTurnMessage = CloudSessionTurnMessage | CloudSessionStartMessage

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
