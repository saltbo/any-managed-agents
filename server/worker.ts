import { createApp } from './app'
import { createDeps } from './composition'
import type { Env } from './env'
import type { CloudTurnMessage } from './runtime/turn-queue'
import { dispatchDueScheduledTriggers } from './scheduled-dispatch'
import { consumeCloudTurnMessage, markCloudTurnDeadLettered, markStalledCloudSessions } from './usecases/runtime'

export { Sandbox } from '@cloudflare/sandbox'
export { RunnerSessionChannelObject } from './worker/runner-session-channel'

const app = createApp()

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchDueScheduledTriggers(env, ctx, { heartbeatAt: new Date(event.scheduledTime).toISOString() }))
    ctx.waitUntil(markStalledCloudSessions(createDeps(env)))
  },
  async queue(batch, env) {
    // Messages that exhausted their retries arrive on the dead-letter queue; mark
    // the stranded session errored instead of re-running the turn.
    const deadLetter = batch.queue.endsWith('-dlq')
    const deps = createDeps(env)
    for (const message of batch.messages) {
      try {
        if (deadLetter) {
          await markCloudTurnDeadLettered(deps, message.body as CloudTurnMessage)
        } else {
          await consumeCloudTurnMessage(deps, message.body as CloudTurnMessage)
        }
        message.ack()
      } catch (error) {
        console.error(
          `cloud turn ${deadLetter ? 'dead-letter handler' : 'consumer'} failed for ${message.id}: ${error}`,
        )
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env>
