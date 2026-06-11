import type { AmaSessionEventType } from '../../shared/session-events'

export type RuntimeBridgeRequest = {
  type: 'run'
  requestId: string
  runtime: 'codex' | 'claude-code' | 'copilot'
  sessionId: string
  cwd: string
  env: Record<string, string>
  prompt: string
  provider?: string
  model?: string
  agentSnapshot?: Record<string, unknown>
  runtimeConfig?: Record<string, unknown>
  resumeToken?: string
  resume?: boolean
}

export type RuntimeBridgeControl = {
  type: 'abort' | 'send'
  requestId: string
  message?: string
}

export type RuntimeBridgeUsageRequest = {
  type: 'fetchUsage'
  requestId: string
  runtime: 'codex' | 'claude-code' | 'copilot'
  env: Record<string, string>
}

export type RuntimeBridgeInput = RuntimeBridgeRequest | RuntimeBridgeControl | RuntimeBridgeUsageRequest

/** A provider quota/rate-limit window (host account utilization), per runtime. */
export type RuntimeUsageWindow = {
  label: string
  /** Utilized quota percentage, 0-100. */
  utilization: number
  resetsAt: string
}

export type AmaRuntimeEvent = {
  type: AmaSessionEventType
  payload: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type RuntimeBridgeOutput =
  | { type: 'ready' }
  | { type: 'event'; requestId: string; event: AmaRuntimeEvent }
  | { type: 'resumeToken'; requestId: string; resumeToken: string }
  | { type: 'result'; requestId: string; result: Record<string, unknown> }
  | { type: 'error'; requestId: string; error: { message: string; code?: string; details?: unknown } }
  | { type: 'log'; requestId?: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }

export type RuntimeProviderHandle = {
  events: AsyncIterable<AmaRuntimeEvent>
  abort(): Promise<void>
  send(message: string): Promise<void>
  getResumeToken?(): string | undefined
}

export type RuntimeProviderRequest = RuntimeBridgeRequest

export type RuntimeProvider = {
  readonly name: RuntimeBridgeRequest['runtime']
  execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle>
  /**
   * Resolve the host provider account's quota/rate-limit windows for this
   * runtime (e.g. Claude 5-hour/7-day utilization). Returns null when the
   * runtime has no credentials or the plan exposes no limited quota.
   */
  fetchUsage?(input: { env: Record<string, string> }): Promise<RuntimeUsageWindow[] | null>
}

export function bridgeError(message: string, code?: string, details?: unknown) {
  return { message, ...(code ? { code } : {}), ...(details !== undefined ? { details } : {}) }
}

/**
 * An open-ended async stream fed by push(). Used for mid-run prompt injection:
 * claude-code's query.streamInput closes the CLI's stdin once its iterable
 * finishes, so injected prompts share a single queue that stays open until the
 * run ends instead of one short-lived iterable per send.
 */
export function createAsyncPushQueue<T>() {
  const pending: T[] = []
  let notify: (() => void) | null = null
  let ended = false
  const values = (async function* () {
    while (true) {
      while (pending.length > 0) {
        yield pending.shift() as T
      }
      if (ended) {
        return
      }
      await new Promise<void>((resolve) => {
        notify = resolve
      })
      notify = null
    }
  })()
  return {
    values,
    push(value: T) {
      pending.push(value)
      notify?.()
    },
    end() {
      ended = true
      notify?.()
    },
  }
}

/**
 * Tracks a provider handle's resume token and emits it as soon as it appears
 * or changes, so the runner can persist it before the run completes. Returns a
 * function to call whenever the token may have advanced (after execute and
 * after each event).
 */
export function createResumeTokenWatcher(
  handle: Pick<RuntimeProviderHandle, 'getResumeToken'>,
  emit: (resumeToken: string) => void,
) {
  let lastToken: string | undefined
  return () => {
    const token = handle.getResumeToken?.()
    if (token && token !== lastToken) {
      lastToken = token
      emit(token)
    }
  }
}

export function agentSystemPrompt(request: RuntimeProviderRequest): string | undefined {
  const snapshot = request.agentSnapshot
  if (!snapshot || typeof snapshot !== 'object') return undefined
  const sections: string[] = []
  for (const key of ['systemPrompt', 'instructions']) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim()) {
      sections.push(value.trim())
      break
    }
  }
  const capabilitySection = agentCapabilitiesSection(snapshot)
  if (capabilitySection) sections.push(capabilitySection)
  return sections.length > 0 ? sections.join('\n\n') : undefined
}

function agentCapabilitiesSection(snapshot: Record<string, unknown>): string | undefined {
  const parts: string[] = []
  const skills = stringArray(snapshot.skills)
  if (skills.length > 0) parts.push(`Skills: ${skills.join(', ')}`)
  const tags = stringArray(snapshot.capabilityTags)
  if (tags.length > 0) parts.push(`Capability tags: ${tags.join(', ')}`)
  const subagents = subagentSummaries(snapshot.subagents)
  if (subagents.length > 0) parts.push(`Available subagents: ${subagents.join(', ')}`)
  const handoffPolicy = objectValue(snapshot.handoffPolicy)
  if (Object.keys(handoffPolicy).length > 0) parts.push(`Handoff policy: ${JSON.stringify(handoffPolicy)}`)
  return parts.length > 0 ? `## Agent Capabilities\n\n${parts.join('\n')}` : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function subagentSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const subagent = objectValue(item)
    const username = typeof subagent.username === 'string' ? subagent.username.trim() : ''
    const name = typeof subagent.name === 'string' ? subagent.name.trim() : ''
    const role = typeof subagent.role === 'string' ? subagent.role.trim() : ''
    const label = username || name
    return label ? [`@${label}${role ? ` (${role})` : ''}`] : []
  })
}
