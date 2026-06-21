// The usecases/runtime barrel: deps-first runtime helpers lifted out of the
// env-bound server/runtime data plane. Grows as later steps fold more of the
// runtime orchestration into this layer.

export {
  createToolApprovalGate,
  type ToolApprovalGate,
  writeSessionApprovalState,
} from './approval-gate'
export {
  type CloudTurnDeps,
  type CloudTurnOutcome,
  consumeCloudTurnMessage,
  dispatchInitialPrompt,
  executeCloudSessionTurn,
  markCloudTurnDeadLettered,
  startSessionRuntimeForRow,
} from './cloud-turn'
export { appendRuntimeEvent, loadRuntimeMessages, markInitialPromptFailed } from './events'
export { mcpConnectorIds, resolveMcpSnapshot, validateRuntimeProviderModel } from './provisioning'
export {
  denyRuntimePolicy,
  evaluateRuntimeSandboxOperations,
  markRuntimeExecutionFailed,
  recordRuntimeMessageOutcome,
  recordRuntimeMessageSubmission,
} from './proxy'
export {
  decideRelayPermissionRequest,
  type RunnerChannelDeps,
  type SessionCommandReply,
} from './runner-channel-ingest'
export {
  type ApprovalDecisionResult,
  type ApprovalDeps,
  type ApprovalRowOutput,
  decideSessionApproval,
} from './session-approval'
export {
  type CreateSessionDeps,
  type CreateSessionOptions,
  type CreateSessionResult,
  createSessionForAgent,
  enqueueSelfHostedSessionWork,
  latestRunnerResumeToken,
} from './session-create'
export {
  archiveSession,
  markExpiredPendingSessions,
  type StopSessionResult,
  stopSession,
  unarchiveSession,
} from './session-lifecycle'
export {
  dispatchSessionPrompt,
  type PromptDeps,
  type PromptDispatchOutcome,
} from './session-prompt'
export {
  archiveSession as archiveRuntimeSession,
  createSession as createRuntimeSession,
  decideApproval as decideRuntimeApproval,
  dispatchPrompt as dispatchRuntimePrompt,
  markExpiredPending as markRuntimeExpiredPending,
  stopSession as stopRuntimeSession,
  unarchiveSession as unarchiveRuntimeSession,
} from './sessions'
export {
  assertRuntimeSessionRunning,
  buildSessionTurnCallbacks,
  type SessionTurnCallbacks,
} from './turn-callbacks'
export { markStalledCloudSessions } from './watchdog'
