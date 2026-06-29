import type { SessionEvent } from '@/lib/amarpc'

export type SessionToolTraceStatus = 'running' | 'completed' | 'failed'
export type SessionToolTraceApproval = 'approved' | 'denied' | 'approval required'

export interface SessionToolTraceEntry {
  key: string
  correlationId: string | null
  toolCallId: string | null
  name: string
  status: SessionToolTraceStatus
  approval: SessionToolTraceApproval
  orphanedResult: boolean
  input: unknown
  output: unknown
  errorSummary: string | null
  durationMs: number | null
  startedAt: string | null
  completedAt: string | null
}

const ERROR_SUMMARY_LIMIT = 240
const VALUE_SUMMARY_LIMIT = 160

interface TraceAccumulator extends SessionToolTraceEntry {
  turnEventId: string | null
  startSequence: number | null
  endSequence: number | null
}

// Builds one trace entry per tool execution from canonical session events.
// Pairing relies on the canonical `correlationId` (`tool:<tool call id>`)
// assigned by the event store; results without a recorded call degrade into
// explicit orphaned entries instead of being dropped.
export function buildSessionToolTrace(events: SessionEvent[]): SessionToolTraceEntry[] {
  const ordered = [...events]
    .filter((event) => event.visibility === 'runtime')
    .sort((left, right) => left.sequence - right.sequence)
  const entries: TraceAccumulator[] = []
  for (const event of ordered) {
    if (event.type === 'tool_execution_start') {
      entries.push(entryFromStart(event))
      continue
    }
    if (event.type === 'tool_execution_end') {
      const open = findOpenEntry(entries, pairingKey(event))
      if (open) {
        completeEntry(open, event)
      } else {
        entries.push(orphanedEntryFromEnd(event))
      }
    }
  }
  const denials = ordered.filter(
    (event) => event.type === 'policy.decision' && objectValue(event.payload).allowed === false,
  )
  return entries.map((entry) => ({ ...entry, approval: approvalState(entry, denials) }))
}

export function summarizeToolValue(value: unknown): string {
  const text = toolValueText(value)
  if (!text) {
    return 'None'
  }
  return truncate(text.replace(/\s+/g, ' ').trim(), VALUE_SUMMARY_LIMIT)
}

function entryFromStart(event: SessionEvent): TraceAccumulator {
  const payload = objectValue(event.payload)
  return {
    key: event.id,
    correlationId: event.correlationId,
    toolCallId: stringField(payload, 'toolCallId'),
    name: stringField(payload, 'toolName') ?? 'tool',
    status: 'running',
    approval: 'approved',
    orphanedResult: false,
    input: payload.args,
    output: undefined,
    errorSummary: null,
    durationMs: null,
    startedAt: event.createdAt,
    completedAt: null,
    turnEventId: event.parentEventId,
    startSequence: event.sequence,
    endSequence: null,
  }
}

function completeEntry(entry: TraceAccumulator, event: SessionEvent) {
  const payload = objectValue(event.payload)
  const failed = payload.isError === true
  entry.status = failed ? 'failed' : 'completed'
  entry.output = payload.result
  entry.errorSummary = failed
    ? truncate(toolValueText(payload.result) || 'Tool execution failed', ERROR_SUMMARY_LIMIT)
    : null
  entry.durationMs = numberField(payload, 'durationMs') ?? elapsedMs(entry.startedAt, event.createdAt)
  entry.completedAt = event.createdAt
  entry.endSequence = event.sequence
}

function orphanedEntryFromEnd(event: SessionEvent): TraceAccumulator {
  const payload = objectValue(event.payload)
  const failed = payload.isError === true
  return {
    key: event.id,
    correlationId: event.correlationId,
    toolCallId: stringField(payload, 'toolCallId'),
    name: stringField(payload, 'toolName') ?? 'tool',
    status: failed ? 'failed' : 'completed',
    approval: 'approved',
    orphanedResult: true,
    input: undefined,
    output: payload.result,
    errorSummary: failed
      ? truncate(toolValueText(payload.result) || 'Tool execution failed', ERROR_SUMMARY_LIMIT)
      : null,
    durationMs: numberField(payload, 'durationMs'),
    startedAt: null,
    completedAt: event.createdAt,
    turnEventId: event.parentEventId,
    startSequence: null,
    endSequence: event.sequence,
  }
}

function pairingKey(event: SessionEvent) {
  return event.correlationId ?? `tool:${stringField(objectValue(event.payload), 'toolCallId') ?? event.id}`
}

function findOpenEntry(entries: TraceAccumulator[], key: string) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && entry.status === 'running' && (entry.correlationId ?? `tool:${entry.toolCallId ?? ''}`) === key) {
      return entry
    }
  }
  return null
}

// A denial recorded inside the same turn while the tool call was in flight is
// the canonical approval outcome for that call.
function approvalState(entry: TraceAccumulator, denials: SessionEvent[]): SessionToolTraceApproval {
  const command = stringField(objectValue(entry.input), 'command')
  const denial = denials.find((event) => {
    if (event.parentEventId !== entry.turnEventId || entry.startSequence === null) {
      return false
    }
    if (event.sequence < entry.startSequence || (entry.endSequence !== null && event.sequence > entry.endSequence)) {
      return false
    }
    const denialCommand = stringField(objectValue(event.payload), 'command')
    return !command || !denialCommand || denialCommand === command
  })
  if (!denial) {
    return 'approved'
  }
  return objectValue(denial.payload).category === 'approval' ? 'approval required' : 'denied'
}

function toolValueText(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  const record = objectValue(value)
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) => {
        const contentItem = objectValue(item)
        return contentItem.type === 'text' && typeof contentItem.text === 'string' ? contentItem.text : ''
      })
      .join('')
    if (text) {
      return text
    }
  }
  return JSON.stringify(value) ?? ''
}

function elapsedMs(start: string | null, end: string) {
  if (!start) {
    return null
  }
  const elapsed = Date.parse(end) - Date.parse(start)
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : null
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'string' ? (record[field] as string) : null
}

function numberField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'number' && Number.isFinite(record[field]) ? (record[field] as number) : null
}
