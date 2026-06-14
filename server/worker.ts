import { createApp } from './app'
import type { Env } from './env'
import { consumeCloudTurnMessage } from './runtime/session-orchestration'
import { markStalledCloudSessions } from './runtime/session-watchdog'
import type { CloudTurnMessage } from './runtime/turn-queue'
import { dispatchDueScheduledTriggers } from './scheduled-dispatch'

export { Sandbox } from '@cloudflare/sandbox'
export { ManagedAgent } from './runtime/managed-agent'
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
    for (const message of batch.messages) {
      try {
        await consumeCloudTurnMessage(env, message.body as CloudTurnMessage)
        message.ack()
      } catch (error) {
        console.error(`cloud turn failed for message ${message.id}: ${error}`)
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env>
