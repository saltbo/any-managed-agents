// The usecases/runtime barrel: deps-first runtime helpers lifted out of the
// env-bound server/runtime data plane. Grows as later steps fold more of the
// runtime orchestration into this layer.

export {
  createToolApprovalGate,
  type ToolApprovalGate,
  writeSessionApprovalState,
} from './approval-gate'
export { appendRuntimeEvent, loadRuntimeMessages, markInitialPromptFailed } from './events'
export {
  mcpConnectorIds,
  resolveMcpSnapshot,
  resolveSessionProviderId,
  validateRuntimeProviderModel,
} from './provisioning'
export {
  denyRuntimePolicy,
  evaluateRuntimeSandboxOperations,
  markRuntimeExecutionFailed,
  recordRuntimeMessageOutcome,
  recordRuntimeMessageSubmission,
} from './proxy'
export {
  assertRuntimeSessionRunning,
  buildSessionTurnCallbacks,
  type SessionTurnCallbacks,
} from './turn-callbacks'
