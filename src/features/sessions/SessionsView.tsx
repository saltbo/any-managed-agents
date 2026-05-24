import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TableSurface } from '@/console/components'
import { formatDate, formatDuration } from '@/console/format'
import type { Session } from '@/lib/api'

export function SessionsView({
  sessions,
  selectedIds,
  setSelectedIds,
  onArchive,
}: {
  sessions: Session[]
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  onArchive: (id: string) => void
}) {
  const selectableIds = sessions.filter((session) => session.status !== 'archived').map((session) => session.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id))
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? selectableIds : [])
  }
  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(checked ? [...selectedIds, id] : selectedIds.filter((selectedId) => selectedId !== id))
  }

  if (sessions.length === 0) {
    return <EmptyState title="No sessions" body="Create a session from an active agent and environment." />
  }
  return (
    <TableSurface tableClassName="min-w-[1120px] table-fixed">
      <colgroup>
        <col className="w-10" />
        <col className="w-[260px]" />
        <col className="w-[120px]" />
        <col className="w-[220px]" />
        <col className="w-[170px]" />
        <col className="w-[145px]" />
        <col className="w-[145px]" />
        <col className="w-[110px]" />
        <col className="w-[110px]" />
        <col className="w-[140px]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Checkbox
              checked={allSelected}
              disabled={selectableIds.length === 0}
              aria-label="Select all sessions"
              onCheckedChange={(checked) => toggleAll(checked === true)}
            />
          </TableHead>
          <TableHead>Session</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Environment</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell>
              <Checkbox
                checked={selectedIds.includes(session.id)}
                disabled={session.status === 'archived'}
                aria-label={`Select ${session.title ?? session.id}`}
                onCheckedChange={(checked) => toggleOne(session.id, checked === true)}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <Link className="block truncate font-medium hover:underline" to={`/sessions/${session.id}`}>
                {session.title ?? session.id}
              </Link>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {`${session.id} · ${session.modelProvider} / ${String(session.modelConfig.model ?? 'default')}`}
              </span>
            </TableCell>
            <TableCell className="min-w-0">
              <StatusBadge value={session.status} />
              {session.statusReason ? (
                <span className="mt-1 hidden truncate text-xs text-muted-foreground md:block">
                  {session.statusReason}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{session.agentSnapshot.systemPrompt ?? session.agentId}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{session.agentId}</span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{session.modelProvider}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {String(session.modelConfig.model ?? 'default')}
              </span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">
                {String(session.environmentSnapshot?.runtimeImage.image ?? 'None')}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {session.environmentId ?? 'None'}
              </span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{formatDate(session.startedAt)}</span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{formatDate(session.updatedAt)}</span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{formatDuration(session.startedAt, session.stoppedAt)}</span>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link to={`/sessions/${session.id}`}>Open</Link>
                </Button>
                {session.status !== 'archived' ? (
                  <ConfirmAction
                    title="Archive session?"
                    description="Archive the selected session from active operations while preserving persisted events."
                    confirmLabel="Archive session"
                    destructive
                    onConfirm={() => onArchive(session.id)}
                  >
                    <Button type="button" variant="ghost" size="sm">
                      Archive
                    </Button>
                  </ConfirmAction>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
