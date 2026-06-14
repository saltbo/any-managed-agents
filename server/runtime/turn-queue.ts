import { createCloudTurnQueue } from '../adapters/gateways/cloud-turn-queue'
import type { Env } from '../env'
import type { CloudTurnMessage } from '../usecases/ports'

// The CloudTurnMessage union is the usecase ↔ queue-worker contract and lives in
// usecases/ports. Re-exported here so existing importers keep their import path.
export type {
  CloudSessionStartMessage,
  CloudSessionStepMessage,
  CloudSessionTurnMessage,
  CloudTurnMessage,
} from '../usecases/ports'

// Test mode (and local setups without the queue binding) run turns inline so
// existing synchronous semantics and assertions keep working.
export function cloudTurnsRunInline(env: Env): boolean {
  return createCloudTurnQueue(env).runsInline()
}

export async function enqueueCloudTurn(
  env: Env,
  message: CloudTurnMessage,
  options?: { delaySeconds?: number },
): Promise<void> {
  await createCloudTurnQueue(env).enqueue(message, options)
}
