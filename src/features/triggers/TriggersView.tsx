import { Pause, Play, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { formatRelativeTime } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Trigger } from '@/lib/api'

export function formatInterval(intervalSeconds: number) {
  if (intervalSeconds % 86400 === 0) {
    return `every ${intervalSeconds / 86400}d`
  }
  if (intervalSeconds % 3600 === 0) {
    return `every ${intervalSeconds / 3600}h`
  }
  if (intervalSeconds % 60 === 0) {
    return `every ${intervalSeconds / 60}m`
  }
  return `every ${intervalSeconds}s`
}

function triggerTiming(trigger: Trigger) {
  if (trigger.type === 'http') {
    return 'HTTP POST'
  }
  return trigger.schedule ? formatInterval(trigger.schedule.intervalSeconds) : '—'
}

export function TriggersView({
  triggers,
  pagination,
  onPause,
  onResume,
  onDelete,
}: {
  triggers: Trigger[]
  pagination: ClientPagination<Trigger>
  onPause: (id: string) => void
  onResume: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (triggers.length === 0) {
    return <EmptyState title="No triggers" body="Schedule a trigger to dispatch an agent on a recurring interval." />
  }
  return (
    <TableSurface
      tableId="triggers"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <TableHeader>
        <TableRow>
          <TableHead>Trigger</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Next due</TableHead>
          <TableHead>Last run</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {triggers.map((trigger) => (
          <TableRow key={trigger.id}>
            <TableCell className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link className="truncate font-medium hover:underline" to={`/triggers/${trigger.id}`}>
                  {trigger.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">{trigger.id}</span>
              </div>
            </TableCell>
            <TableCell className="max-w-48 truncate">{trigger.agentId}</TableCell>
            <TableCell>{triggerTiming(trigger)}</TableCell>
            <TableCell>
              <StatusBadge value={trigger.enabled ? 'active' : 'paused'} />
            </TableCell>
            <TableCell>{trigger.nextDueAt ? formatRelativeTime(trigger.nextDueAt) : '—'}</TableCell>
            <TableCell>{trigger.lastDispatchedAt ? formatRelativeTime(trigger.lastDispatchedAt) : '—'}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                {trigger.enabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Pause trigger"
                    onClick={() => onPause(trigger.id)}
                  >
                    <Pause data-icon="inline-start" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Resume trigger"
                    onClick={() => onResume(trigger.id)}
                  >
                    <Play data-icon="inline-start" />
                  </Button>
                )}
                <ConfirmAction
                  title="Delete trigger?"
                  description={`Permanently delete ${trigger.name} and its run history. This cannot be undone.`}
                  confirmLabel="Delete trigger"
                  destructive
                  onConfirm={() => onDelete(trigger.id)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Delete trigger">
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </ConfirmAction>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
