import { createApp } from '../server/app'
import type { Env } from '../server/env'
import { dispatchDueScheduledTriggers } from '../server/schedules/dispatcher'

export { Sandbox } from '@cloudflare/sandbox'
export { ManagedAgent } from '../server/agents/managed-agent'

const app = createApp()

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchDueScheduledTriggers(env, ctx, { heartbeatAt: new Date(event.scheduledTime).toISOString() }))
  },
} satisfies ExportedHandler<Env>
