import { CheckCircle2, Loader2, TerminalSquare, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/console/components'
import { formatMillis, formatTime, stringifyJson } from '@/console/format'
import { type SessionToolTraceEntry, summarizeToolValue } from '@/features/sessions/session-tool-trace'
import { cn } from '@/lib/utils'

export function SessionToolTrace({ entries }: { entries: SessionToolTraceEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No tool calls yet"
        body="Tool executions appear here with inputs, outputs, approval state, errors, and timing once the agent uses a tool."
      />
    )
  }
  return (
    <div className="divide-y rounded-lg border">
      {entries.map((entry) => (
        <SessionToolTraceItem key={entry.key} entry={entry} />
      ))}
    </div>
  )
}

function SessionToolTraceItem({ entry }: { entry: SessionToolTraceEntry }) {
  const failed = entry.status === 'failed'
  return (
    <details className={cn('group min-w-0 p-3', failed && 'bg-destructive/5')} data-status={entry.status}>
      <summary className="flex cursor-pointer list-none flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {entry.status === 'running' ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : failed ? (
            <XCircle className="size-4 text-destructive" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
          )}
          <TerminalSquare className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0 break-all font-mono text-sm font-medium">{entry.name}</span>
          <Badge variant={failed ? 'destructive' : entry.status === 'running' ? 'secondary' : 'outline'}>
            {entry.status}
          </Badge>
          <Badge variant={entry.approval === 'approved' ? 'outline' : 'destructive'}>{entry.approval}</Badge>
          {entry.durationMs !== null ? (
            <span className="text-xs text-muted-foreground">{formatMillis(entry.durationMs)}</span>
          ) : null}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatTime(entry.startedAt ?? entry.completedAt)}
          </span>
        </div>
        {entry.orphanedResult ? (
          <p className="text-xs text-muted-foreground">
            Result without a recorded tool call. Showing the result data that was received.
          </p>
        ) : null}
        <dl className="grid min-w-0 gap-1 text-xs">
          <TraceSummaryLine label="Input" value={summarizeToolValue(entry.input)} />
          {failed ? (
            <TraceSummaryLine label="Error" value={entry.errorSummary ?? 'Tool execution failed'} tone="error" />
          ) : (
            <TraceSummaryLine label="Output" value={summarizeToolValue(entry.output)} />
          )}
        </dl>
      </summary>
      <div className="mt-3 grid min-w-0 gap-2">
        <TraceDetailBlock label="Input detail" value={entry.input} />
        <TraceDetailBlock label="Output detail" value={entry.output} />
        {failed ? (
          <TraceDetailBlock label="Error detail" value={entry.errorSummary ?? 'Tool execution failed'} tone="error" />
        ) : null}
      </div>
    </details>
  )
}

function TraceSummaryLine({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'error'
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 truncate font-mono', tone === 'error' && 'text-destructive')}>{value}</dd>
    </div>
  )
}

function TraceDetailBlock({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: unknown
  tone?: 'default' | 'error'
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <pre
        className={cn(
          'max-h-60 overflow-auto rounded-md border bg-background p-2 text-xs break-all whitespace-pre-wrap',
          tone === 'error' && 'border-destructive/30 text-destructive',
        )}
      >
        {detailText(value)}
      </pre>
    </div>
  )
}

function detailText(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 'None'
  }
  return typeof value === 'string' ? value : stringifyJson(value)
}
