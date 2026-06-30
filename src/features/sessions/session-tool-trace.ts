import type { EventRecord } from '@/lib/amarpc'

export type SessionToolTraceStatus = 'running' | 'completed' | 'failed'
export type SessionToolTraceApproval = 'approved' | 'denied' | 'approval required'

export interface SessionToolTraceEntry {
  key: string
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
  startSequence: number | null
  endSequence: number | null
}

// Builds one trace entry per tool execution from canonical AMA events. Pairing
// uses the tool call id inside the event payload; results without a recorded
// call degrade into explicit orphaned entries instead of being dropped.
export function buildSessionToolTrace(events: EventRecord[]): SessionToolTraceEntry[] {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence)
  const entries: TraceAccumulator[] = []
  for (const record of ordered) {
    if (record.event.type === 'tool_execution_start') {
      entries.push(entryFromStart(record))
      continue
    }
    if (record.event.type === 'tool_execution_end') {
      const open = findOpenEntry(entries, pairingKey(record))
      if (open) {
        completeEntry(open, record)
      } else {
        entries.push(orphanedEntryFromEnd(record))
      }
    }
  }
  const denials = ordered.filter(
    (record) => record.event.type === 'policy.decision' && objectValue(record.event.payload).allowed === false,
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

function entryFromStart(record: EventRecord): TraceAccumulator {
  const payload = objectValue(record.event.payload)
  const toolCall = objectValue(payload.toolCall)
  return {
    key: record.id,
    toolCallId: stringField(toolCall, 'id'),
    name: stringField(toolCall, 'name') ?? 'tool',
    status: 'running',
    approval: 'approved',
    orphanedResult: false,
    input: toolCall.input,
    output: undefined,
    errorSummary: null,
    durationMs: null,
    startedAt: record.createdAt,
    completedAt: null,
    startSequence: record.sequence,
    endSequence: null,
  }
}

function completeEntry(entry: TraceAccumulator, record: EventRecord) {
  const payload = objectValue(record.event.payload)
  const failed = payload.isError === true || Boolean(payload.error)
  entry.status = failed ? 'failed' : 'completed'
  entry.output = payload.result
  entry.errorSummary = failed
    ? truncate(toolValueText(payload.error ?? payload.result) || 'Tool execution failed', ERROR_SUMMARY_LIMIT)
    : null
  entry.durationMs = numberField(payload, 'durationMs') ?? elapsedMs(entry.startedAt, record.createdAt)
  entry.completedAt = record.createdAt
  entry.endSequence = record.sequence
}

function orphanedEntryFromEnd(record: EventRecord): TraceAccumulator {
  const payload = objectValue(record.event.payload)
  const toolCall = objectValue(payload.toolCall)
  const failed = payload.isError === true || Boolean(payload.error)
  return {
    key: record.id,
    toolCallId: stringField(toolCall, 'id'),
    name: stringField(toolCall, 'name') ?? 'tool',
    status: failed ? 'failed' : 'completed',
    approval: 'approved',
    orphanedResult: true,
    input: toolCall.input,
    output: payload.result,
    errorSummary: failed
      ? truncate(toolValueText(payload.error ?? payload.result) || 'Tool execution failed', ERROR_SUMMARY_LIMIT)
      : null,
    durationMs: numberField(payload, 'durationMs'),
    startedAt: null,
    completedAt: record.createdAt,
    startSequence: null,
    endSequence: record.sequence,
  }
}

function pairingKey(record: EventRecord) {
  const toolCall = objectValue(objectValue(record.event.payload).toolCall)
  return stringField(toolCall, 'id') ?? record.id
}

function findOpenEntry(entries: TraceAccumulator[], key: string) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && entry.status === 'running' && (entry.toolCallId ?? entry.key) === key) {
      return entry
    }
  }
  return null
}

// A denial recorded inside the same turn while the tool call was in flight is
// the canonical approval outcome for that call.
function approvalState(entry: TraceAccumulator, denials: EventRecord[]): SessionToolTraceApproval {
  const command = stringField(objectValue(entry.input), 'command')
  const denial = denials.find((record) => {
    if (entry.startSequence === null) {
      return false
    }
    if (record.sequence < entry.startSequence || (entry.endSequence !== null && record.sequence > entry.endSequence)) {
      return false
    }
    const denialCommand = stringField(objectValue(record.event.payload), 'command')
    return !command || !denialCommand || denialCommand === command
  })
  if (!denial) {
    return 'approved'
  }
  return objectValue(denial.event.payload).category === 'approval' ? 'approval required' : 'denied'
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
