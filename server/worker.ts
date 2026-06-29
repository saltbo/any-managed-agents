import { createApp } from './app'
import { createDeps } from './composition'
import type { Env } from './env'
import { dispatchDueScheduledTriggers } from './scheduled-dispatch'
import type { CloudTurnMessage } from './usecases/ports'
import { refreshPlatformCatalog } from './usecases/providers'
import { consumeCloudTurnMessage, markCloudTurnDeadLettered, markStalledCloudSessions } from './usecases/runtime'

export { Sandbox } from '@cloudflare/sandbox'
export { RunnerPoolObject } from './worker/runner-pool-object'
export { SessionObject } from './worker/session-object'

const app = createApp()

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchDueScheduledTriggers(env, ctx, { heartbeatAt: new Date(event.scheduledTime).toISOString() }))
    ctx.waitUntil(markStalledCloudSessions(createDeps(env)))
    // The model catalog changes slowly; refresh once an hour (the cron fires
    // every minute, so gate on minute 0) rather than every tick.
    if (new Date(event.scheduledTime).getUTCMinutes() === 0) {
      ctx.waitUntil(refreshPlatformCatalog(createDeps(env)))
    }
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
