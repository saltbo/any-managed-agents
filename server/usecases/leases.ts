import { runnerCapabilityEligible, runnerRuntimeReady } from '@server/domain/runner-queue'
import type { Deps } from './deps'
import {
  type AuthScope,
  type LeaseRecord,
  type RunnerAuthRecord,
  RunnerConflictError,
  type WorkItemRecord,
} from './ports'

const DEFAULT_LEASE_DURATION_SECONDS = 60

export interface ClaimLeaseRequest {
  workItemId: string
  leaseDurationSeconds: number | undefined
}

// Claims a specific available work item for an already-authorized runner: the
// runner must be active, the work item available and environment-compatible,
// and the runner capability/runtime-ready for the work. The atomic slot
// reservation + work-item flip lives in the repo; claim-time secret resolution
// fails the lease when a referenced credential cannot be resolved so a runner
// never receives an unrunnable session. Throws RunnerConflictError for every
// ineligibility / lost-race outcome (the http layer maps it to 409).
export async function claimLease(
  deps: Deps,
  auth: AuthScope,
  runner: RunnerAuthRecord,
  request: ClaimLeaseRequest,
): Promise<LeaseRecord> {
  await deps.leases.expireStale(auth.project.id)
  if (runner.archivedAt || runner.state !== 'active') {
    throw new RunnerConflictError('Runner is not active')
  }
  const candidate = await deps.leases.claimCandidate(auth.project.id, request.workItemId)
  if (!candidate) {
    throw new RunnerConflictError('Work item not found', 404)
  }
  const timestamp = new Date().toISOString()
  if (candidate.state !== 'available' || candidate.availableAt > timestamp) {
    throw new RunnerConflictError('Work item is not available')
  }
  if (runner.environmentId && candidate.environmentId && candidate.environmentId !== runner.environmentId) {
    throw new RunnerConflictError('Runner is not eligible for this work item')
  }
  if (
    !runnerCapabilityEligible(runner.capabilities, candidate.rawPayload) ||
    !runnerRuntimeReady(
      runner.runtimeInventory.map((entry) => ({ runtime: entry.runtime, state: entry.state })),
      candidate.rawPayload,
    )
  ) {
    throw new RunnerConflictError('Runner is not eligible for this work item')
  }
  const claimed = await deps.leases.claim(
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      workItemId: request.workItemId,
      runnerId: runner.id,
      leaseDurationSeconds: request.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS,
    },
    timestamp,
  )
  if (claimed === 'at_capacity') {
    throw new RunnerConflictError('Runner is at capacity')
  }
  if (claimed === 'work_item_lost') {
    // The repo released the reserved runner slot when the work-item race lost.
    throw new RunnerConflictError('Work item was claimed by another runner')
  }
  // Claim-time secret validation: the lease must not be handed out when the
  // work item's secret env cannot be resolved (for example a revoked credential
  // version). Resolved values are delivered to the runner via the work-item
  // payload; nothing secret is stored here.
  const payload = candidate.rawPayload
  if (
    payload.type === 'session.start' &&
    Array.isArray(payload.runtimeSecretEnv) &&
    payload.runtimeSecretEnv.length > 0
  ) {
    try {
      await deps.runtimeSecretEnv.resolve(
        { organizationId: auth.organization.id, projectId: auth.project.id },
        payload.runtimeSecretEnv,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Runner secret resolution failed'
      await deps.leases.failClaim({
        projectId: auth.project.id,
        leaseId: claimed.lease.id,
        workItemId: request.workItemId,
        runnerId: runner.id,
        sessionId: claimed.sessionId,
        reason: message,
      })
      throw new RunnerConflictError(message)
    }
  }
  return claimed.lease
}

// Materializes the raw work-item payload for the lease-holding runner, resolving
// vault secret env into runtimeEnv. Non-session-start payloads and payloads
// without secret env pass through unchanged.
export async function materializeWorkItemPayload(
  deps: Deps,
  scope: { organizationId: string; projectId: string },
  workItem: WorkItemRecord,
): Promise<Record<string, unknown>> {
  const payload = (await deps.workItems.rawPayload(scope.projectId, workItem.id)) ?? {}
  if (payload.type !== 'session.start') {
    return payload
  }
  const runtimeSecretEnv = Array.isArray(payload.runtimeSecretEnv) ? payload.runtimeSecretEnv : []
  if (runtimeSecretEnv.length === 0) {
    return payload
  }
  const runtimeEnv =
    payload.runtimeEnv && typeof payload.runtimeEnv === 'object' && !Array.isArray(payload.runtimeEnv)
      ? { ...(payload.runtimeEnv as Record<string, string>) }
      : {}
  const resolved = await deps.runtimeSecretEnv.resolve(scope, runtimeSecretEnv)
  return { ...payload, runtimeEnv: { ...runtimeEnv, ...resolved } }
}
