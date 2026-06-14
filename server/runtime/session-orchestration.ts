// Runtime session orchestration — public barrel.
//
// The env-bound session machinery was decomposed into cohesive cluster modules
// within server/runtime/: session-base (shared leaf helpers), cloud-turn (cloud
// turn loop + queue consumer), session-create (create-session orchestration),
// session-lifecycle (stop / archive / expiry), session-prompt (prompt dispatch),
// and session-approval (approval decision continuation). This module re-exports
// the public surface so existing importers — the SessionRuntimeGateway adapter,
// the queue consumer (server/worker), the http layer, and runtime-proxy — keep
// working unchanged.
//
// Every public entry here is Response-free: HTTP concerns (Response, status
// codes, SSE) stay in server/http/sessions.ts. Outcomes cross the boundary as
// discriminated result objects.

export type { SessionRow } from '../adapters/repos/runtime-orchestration'
export { consumeCloudTurnMessage, markCloudTurnDeadLettered } from './cloud-turn'
export { type ApprovalDecisionResult, type ApprovalRowOutput, decideSessionApproval } from './session-approval'
export { appendRuntimeEvent, type SessionRuntimeError } from './session-base'
export {
  type CreateSessionOptions,
  type CreateSessionResult,
  createSessionForAgent,
} from './session-create'
export {
  archiveSession,
  markExpiredPendingSessions,
  type StopSessionResult,
  stopSession,
  unarchiveSession,
} from './session-lifecycle'
export { dispatchSessionPrompt, type PromptDispatchOutcome } from './session-prompt'
export type { GitHubRepositoryResourceRef, ResourceRef, SerializedAgentVersion } from './session-snapshot'
export type { PendingSessionApproval } from './tool-approvals'
