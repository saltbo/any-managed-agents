import type { Env } from '../env'
import type { RuntimeSecretEnvEntry } from './secret-env'

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

// Continuation of a paused turn: the transcript is rebuilt from persisted
// events and the loop continues from the trailing tool results. Chaining
// steps lifts the per-invocation wall-clock cap from total turn duration.
// Carries the turnId so the step renews the SAME lease the paused turn holds —
// the continuation chain is one logical turn, so a concurrent prompt that
// arrives mid-chain loses the lease and is deferred until the chain ends.
export type CloudSessionStepMessage = {
  type: 'session.step'
  sessionId: string
  organizationId: string
  projectId: string
  // Present for a budget continuation (renew the held lease); absent for an
  // approval-resume step, which acquires a fresh lease in the consumer.
  turnId?: string
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
  runtimeSecretEnv: RuntimeSecretEnvEntry[]
  initialPrompt?: string
}

export type CloudTurnMessage = CloudSessionTurnMessage | CloudSessionStepMessage | CloudSessionStartMessage

// Test mode (and local setups without the queue binding) run turns inline so
// existing synchronous semantics and assertions keep working.
export function cloudTurnsRunInline(env: Env): boolean {
  return env.AMA_RUNTIME_MODE === 'test' || !env.CLOUD_TURNS
}

export async function enqueueCloudTurn(
  env: Env,
  message: CloudTurnMessage,
  options?: { delaySeconds?: number },
): Promise<void> {
  if (!env.CLOUD_TURNS) {
    throw new Error('CLOUD_TURNS queue binding is not configured')
  }
  await env.CLOUD_TURNS.send(
    message,
    options?.delaySeconds !== undefined ? { delaySeconds: options.delaySeconds } : undefined,
  )
}
