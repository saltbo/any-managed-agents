// Runner session channel ingest — deps-first. The control-plane decisions for an
// untrusted self-hosted runner connection, lifted out of the
// RunnerSessionChannelObject durable object so the DO is a thin socket shell.
//
// This module owns: ownership validation (lease/work-item/channel/session-state
// over deps.sessionOrchestration), the redact-and-append of a runner-emitted
// canonical event, the permission-request policy decision (deps.policy +
// the policy.decision event + the session.command reply build), and the
// close/requeue recovery path. It never touches the WebSocket: each function
// takes plain inputs (a parsed message, the current channel state snapshot) and
// returns decisions/results the DO shell acts on. Infra-free: deps + domain +
// shared (+ the leaf redaction helper) only.

import { channelSystemAuth } from '@server/domain/runtime/system-auth'
import { redactSensitiveValue } from '@server/redaction'
import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import { canonicalAmaSessionEventFromRuntimeEvent } from '@shared/session-events'
import type { PolicyPort, SessionOrchestrationStore } from '../ports'

export type ChannelState = {
  channelId: string
  sessionId: string
  workItemId: string
  leaseId: string
  runnerId: string
  organizationId: string
  projectId: string
}

export type RunnerChannelDeps = {
  sessionOrchestration: SessionOrchestrationStore
  policy: PolicyPort
}

export type RunnerCanonicalEvent = {
  type: string
  payload: Record<string, unknown>
  metadata?: Record<string, unknown>
}

// Signals that the runner lost ownership of the work (lease/work-item/channel/
// session-state no longer match). The DO shell deactivates the channel (4001
// stale) on this error specifically; the plain 'no longer active' error (a
// missing work item) only surfaces in the generic error frame, matching the
// original DO's two distinct paths.
export class RunnerChannelOwnershipLostError extends Error {
  constructor() {
    super('Runner session channel is no longer active')
    this.name = 'RunnerChannelOwnershipLostError'
  }
}

// A reply the DO shell should send back to the owning runner over the socket.
export type SessionCommandReply = {
  type: 'session.command'
  sessionId: string
  runnerId: string
  leaseId: string
  workItemId: string
  command: Record<string, unknown>
}

// The lease/work-item/channel/session-state ownership checks. A runner that lost
// its lease, whose work item is no longer leased to it, whose channel was
// superseded, or whose session left 'running' is no longer the owner.
export async function validateActiveOwnership(deps: RunnerChannelDeps, state: ChannelState): Promise<boolean> {
  const store = deps.sessionOrchestration
  const channel = await store.channelActiveChannel(state)
  const lease = await store.channelActiveLease(state)
  const workItem = await store.channelWorkItem(state.projectId, state.workItemId)
  const session = await store.channelSessionState(state.projectId, state.sessionId)
  if (
    !channel ||
    !lease ||
    !workItem ||
    lease.expiresAt <= new Date().toISOString() ||
    workItem.state !== 'leased' ||
    workItem.leaseId !== state.leaseId ||
    workItem.runnerId !== state.runnerId ||
    workItem.sessionId !== state.sessionId ||
    session?.state !== 'running' ||
    session.stateReason !== null
  ) {
    return false
  }
  return true
}

// Validates ownership, then redacts + appends the runner-emitted event as a
// canonical session event. Throws 'no longer active' when the runner no longer
// owns the work — the DO shell deactivates the channel on that signal.
export async function appendRunnerEvent(
  deps: RunnerChannelDeps,
  state: ChannelState,
  event: RunnerCanonicalEvent,
): Promise<void> {
  const store = deps.sessionOrchestration
  const valid = await validateActiveOwnership(deps, state)
  if (!valid) {
    throw new RunnerChannelOwnershipLostError()
  }
  const workItem = await store.channelWorkItem(state.projectId, state.workItemId)
  if (!workItem) {
    throw new Error('Runner session channel is no longer active')
  }
  const timestamp = new Date().toISOString()
  await store.touchChannel(state.channelId, timestamp)
  await appendSessionEvent(store, state, event, workItemRuntimeMetadata(workItem.payload))
}

// An official-runtime permission request is decided by AMA session policy before
// the action runs: the decision is recorded as a canonical policy event and the
// session.command reply for the owning runner is returned to the DO shell. Null
// means there was no session to decide against (no reply, no event).
export async function decidePermissionRequest(
  deps: RunnerChannelDeps,
  state: ChannelState,
  payload: Record<string, unknown>,
): Promise<SessionCommandReply | null> {
  const store = deps.sessionOrchestration
  const auth = channelSystemAuth(state)
  const session = await store.channelSession(state.projectId, state.sessionId)
  if (!session) {
    return null
  }
  const permissionId = typeof payload.permissionId === 'string' ? payload.permissionId : 'permission'
  const command = typeof payload.command === 'string' ? payload.command : null
  const decision = await deps.policy.evaluateSandboxRuntime(auth, {
    session: {
      id: session.id,
      agentSnapshot: session.agentSnapshot,
      environmentSnapshot: session.environmentSnapshot,
    },
    operation: 'command',
    command,
    host: null,
  })
  await appendRunnerEvent(deps, state, {
    type: 'policy.decision',
    payload: {
      allowed: decision.allowed,
      category: decision.category ?? 'sandbox',
      ruleId: decision.rule,
      resourceType: 'runtime_permission',
      resourceId: typeof payload.action === 'string' ? payload.action : 'action',
      operation: 'runtime_permission_decision',
      decision: {
        permissionId,
        allowed: decision.allowed,
        ...(decision.message ? { reason: decision.message } : {}),
      },
    },
    metadata: { source: 'policy' },
  })
  return {
    type: 'session.command',
    sessionId: state.sessionId,
    runnerId: state.runnerId,
    leaseId: state.leaseId,
    workItemId: state.workItemId,
    command: {
      type: 'permission_decision',
      permissionId,
      allowed: decision.allowed,
      reason: decision.message ?? '',
    },
  }
}

// Channel teardown: closes the channel row and, when the session is still
// running, requeues it for runner recovery and records the closed event. Pure
// orchestration over the store — the DO shell owns the socket close + code.
export async function deactivateRunnerChannel(
  deps: RunnerChannelDeps,
  state: ChannelState,
  reason: string,
  channelState: 'closed' | 'stale',
): Promise<void> {
  const store = deps.sessionOrchestration
  const timestamp = new Date().toISOString()
  await store.closeChannel(state.channelId, channelState, reason, timestamp)
  const session = await store.channelSessionState(state.projectId, state.sessionId)
  if (session?.state !== 'running') {
    return
  }
  await store.requeueSessionForRunnerRecovery(state.projectId, state.sessionId, timestamp)
  await appendSessionEvent(
    store,
    state,
    { type: 'runner.channel.closed', payload: { reason }, metadata: { source: 'self-hosted-runner-channel' } },
    {},
  )
}

function parseJson<T>(value: string | null) {
  return value ? (redactSensitiveValue(JSON.parse(value)) as T) : null
}

function workItemRuntimeMetadata(payloadValue: string) {
  const payload = parseJson<Record<string, unknown>>(payloadValue) ?? {}
  return {
    ...(typeof payload.runtime === 'string' ? { runtime: payload.runtime } : {}),
    ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
    ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
  }
}

// The self-hosted runner is untrusted: scrub secret-shaped values out of the
// runner-emitted payload (and metadata) before they reach the canonical event
// store, matching how other inputs in this flow are redacted.
export function buildRedactedRunnerCanonicalEvent(
  state: Pick<ChannelState, 'channelId' | 'runnerId' | 'leaseId' | 'workItemId'>,
  event: RunnerCanonicalEvent,
  runtimeMetadata: Record<string, unknown>,
): CanonicalAmaSessionEvent {
  const payload = redactSensitiveValue(event.payload) as Record<string, unknown>
  const metadata = event.metadata ? (redactSensitiveValue(event.metadata) as Record<string, unknown>) : undefined
  return canonicalAmaSessionEventFromRuntimeEvent(
    { type: event.type, ...payload },
    {
      source: 'self-hosted-runner',
      ...(metadata ?? {}),
      ...runtimeMetadata,
      channelId: state.channelId,
      runnerId: state.runnerId,
      leaseId: state.leaseId,
      workItemId: state.workItemId,
    },
  )
}

async function appendSessionEvent(
  store: SessionOrchestrationStore,
  state: ChannelState,
  event: RunnerCanonicalEvent,
  runtimeMetadata: Record<string, unknown>,
) {
  const canonicalEvent = buildRedactedRunnerCanonicalEvent(state, event, runtimeMetadata)
  await store.appendCanonicalEvent(
    {
      organizationId: state.organizationId,
      projectId: state.projectId,
      sessionId: state.sessionId,
    },
    canonicalEvent,
  )
}
