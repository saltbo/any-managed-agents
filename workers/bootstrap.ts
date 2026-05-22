import { createApp } from '../server/app'
import type { Env } from '../server/env'

export { ManagedAgent } from '../server/agents/managed-agent'

const app = createApp()

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
