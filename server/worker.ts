import { createApp } from './app'
import type { Env } from './env'
import { consumeCloudTurnMessage, markCloudTurnDeadLettered } from './runtime/cloud-turn'
import { markStalledCloudSessions } from './runtime/session-watchdog'
import type { CloudTurnMessage } from './runtime/turn-queue'
import { dispatchDueScheduledTriggers } from './scheduled-dispatch'

export { Sandbox } from '@cloudflare/sandbox'
export { RunnerSessionChannelObject } from './runtime/runner-session-channel'

const app = createApp()

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchDueScheduledTriggers(env, ctx, { heartbeatAt: new Date(event.scheduledTime).toISOString() }))
    ctx.waitUntil(markStalledCloudSessions(env))
  },
  async queue(batch, env) {
    // Messages that exhausted their retries arrive on the dead-letter queue; mark
    // the stranded session errored instead of re-running the turn.
    const deadLetter = batch.queue.endsWith('-dlq')
    for (const message of batch.messages) {
      try {
        if (deadLetter) {
          await markCloudTurnDeadLettered(env, message.body as CloudTurnMessage)
        } else {
          await consumeCloudTurnMessage(env, message.body as CloudTurnMessage)
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
