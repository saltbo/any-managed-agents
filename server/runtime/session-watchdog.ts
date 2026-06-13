import {
  createRuntimeOrchestrationRepoFromBinding,
  type RuntimeOrchestrationRepo,
} from '../adapters/repos/runtime-orchestration'
import type { Env } from '../env'
import { stopSessionRuntime } from './session-runtime'

// A queue-consumer invocation owns at most ~15 minutes of wall clock; a cloud
// session still "running" (turn) or "pending" (startup) past this window lost
// its consumer and would otherwise stay stuck forever. Marking it as error
// lets clients (and AK's reconcile sweep) recover the work.
const STALLED_THRESHOLD_MS = 20 * 60_000

const TERMINAL_STATES = ['stopped', 'error']

export async function markStalledCloudSessions(env: Env): Promise<void> {
  const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)
  const threshold = new Date(Date.now() - STALLED_THRESHOLD_MS).toISOString()
  // a cloud turn lost its consumer mid-run, or a cloud startup died before
  // assigning a sandbox; self-hosted sessions waiting for a runner carry a
  // stateReason and may wait indefinitely, so they are excluded
  await repo.markStalledCloudSessions(threshold, new Date().toISOString())
  await destroyLeakedSandboxes(env, repo)
}

// Sandboxes of ended sessions occupy container instances (max_instances is a
// hard cap) when teardown was skipped — e.g. a stop while an exec was hung.
// Destroy them and stamp the session so each sandbox is cleaned exactly once.
async function destroyLeakedSandboxes(env: Env, repo: RuntimeOrchestrationRepo): Promise<void> {
  // archived is lifecycle (archivedAt), not a state value
  const rows = await repo.leakedSandboxSessions(TERMINAL_STATES, 20)
  for (const row of rows) {
    if (!row.sandboxId) continue
    try {
      await stopSessionRuntime(env, row.sandboxId)
    } catch {
      // instance may already be gone; stamping below prevents retry loops
    }
    const metadata = parseMetadata(row.metadata)
    metadata.sandboxDestroyedAt = new Date().toISOString()
    await repo.stampSandboxDestroyed(row.id, JSON.stringify(metadata))
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
