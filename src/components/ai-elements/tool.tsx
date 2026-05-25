import { CheckCircle2, Loader2, TerminalSquare, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function Tool({
  name,
  status,
  input,
  output,
  error,
  durationMs,
  createdAt,
}: {
  name: string
  status: 'running' | 'success' | 'error'
  input?: unknown
  output?: unknown
  error?: string | null
  durationMs?: number | null
  createdAt?: string
}) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3 border-b py-3 last:border-b-0">
      <div className="flex justify-end">
        <Badge variant={status === 'error' ? 'destructive' : 'outline'}>Tool</Badge>
      </div>
      <div className="min-w-0 rounded-lg border bg-muted/25">
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          {status === 'running' ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : status === 'success' ? (
            <CheckCircle2 className="size-4 text-emerald-600" />
          ) : (
            <XCircle className="size-4 text-destructive" />
          )}
          <TerminalSquare className="size-4 text-muted-foreground" />
          <span className="truncate font-mono text-sm">{name}</span>
          <ToolStatusBadge status={status} error={error} />
          {createdAt ? <span className="text-xs text-muted-foreground">{formatToolTime(createdAt)}</span> : null}
          {typeof durationMs === 'number' ? (
            <span className="text-xs text-muted-foreground">{Math.round(durationMs)}ms</span>
          ) : null}
        </div>
        <div className="grid gap-2 p-3 text-sm">
          <ToolValue label="Input" value={input} />
          <ToolValue label={error ? 'Error' : 'Output'} value={error ?? output} tone={error ? 'error' : 'default'} />
        </div>
      </div>
    </div>
  )
}

function ToolStatusBadge({
  status,
  error,
}: {
  status: 'running' | 'success' | 'error'
  error?: string | null | undefined
}) {
  const badge = (
    <Badge variant="secondary" className="ml-auto capitalize">
      {status}
    </Badge>
  )
  if (status !== 'error' || !error) {
    return badge
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`error: ${error}`}
            className="ml-auto inline-flex cursor-help border-0 bg-transparent p-0"
          >
            {badge}
          </button>
        </TooltipTrigger>
        <TooltipContent>{error}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function ToolValue({ label, value, tone = 'default' }: { label: string; value?: unknown; tone?: 'default' | 'error' }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <pre
        className={cn(
          'max-h-40 overflow-auto rounded-md border bg-background p-2 text-xs whitespace-pre-wrap',
          tone === 'error' && 'border-destructive/30 text-destructive',
        )}
      >
        {formatValue(value)}
      </pre>
    </div>
  )
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 'None'
  }
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value, null, 2)
}

function formatToolTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
