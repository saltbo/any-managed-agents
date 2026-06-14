import type { RuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import { RuntimeTurnCancelledError, runtimeMessagesFromEvents } from './session-runtime'

// Shared setup for the two cloud turn entrypoints — the cloud-command queue path
// (session-orchestration.executeCloudSessionTurn) and the runtime-endpoint proxy
// (runtime-proxy.recordRuntimeMessageOutcome). Both drive the same runtime-core
// engine via runSessionTurn; these keep the transcript load, the liveness guard,
// and the provider/model resolution single-sourced so the two paths can't drift.

export async function loadRuntimeMessages(repo: RuntimeOrchestrationRepo, sessionId: string) {
  return runtimeMessagesFromEvents(await repo.sessionEventStream(sessionId))
}

export async function assertRuntimeSessionRunning(
  repo: RuntimeOrchestrationRepo,
  projectId: string,
  sessionId: string,
) {
  const active = await repo.sessionState(projectId, sessionId)
  if (active?.state !== 'running') {
    throw new RuntimeTurnCancelledError()
  }
}

// Single source for the session's runtime provider + model. The session's pinned
// modelProvider wins; otherwise the agent snapshot's providerId (falling back to
// the platform default). The model prefers the session modelConfig, then the
// agent snapshot, else null (the engine resolves the provider default).
export function resolveSessionProviderModel(
  session: { modelProvider: string | null },
  agentSnapshot: Record<string, unknown>,
  modelConfig: Record<string, unknown>,
): { provider: string; model: string | null } {
  const provider =
    session.modelProvider ?? (typeof agentSnapshot.providerId === 'string' ? agentSnapshot.providerId : 'workers-ai')
  const model =
    typeof modelConfig.model === 'string'
      ? modelConfig.model
      : typeof agentSnapshot.model === 'string'
        ? agentSnapshot.model
        : null
  return { provider, model }
}
