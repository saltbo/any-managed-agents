// Shim: the stalled-session + leaked-sandbox watchdog now lives in
// usecases/runtime/watchdog as a deps-first function over ports. This wrapper
// preserves the (env) signature the queue/cron entry (server/worker) relies on,
// building the watchdog deps subset from the binding inline and delegating.

import { createRuntimeOrchestrationRepoFromBinding } from '../adapters/repos/runtime-orchestration'
import { createSandboxRuntimeHost } from '../adapters/runtime/sandbox-runtime-host'
import type { Env } from '../env'
import { markStalledCloudSessions as markStalledCloudSessionsUsecase } from '../usecases/runtime'

export async function markStalledCloudSessions(env: Env): Promise<void> {
  await markStalledCloudSessionsUsecase({
    sessionOrchestration: createRuntimeOrchestrationRepoFromBinding(env.DB),
    sandboxRuntime: createSandboxRuntimeHost(env),
  })
}
