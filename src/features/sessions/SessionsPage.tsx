import { Archive, MessageSquare } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmAction, PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useConsoleContext } from '@/features/console/console-context'
import type { SessionStatus } from '@/lib/api'
import { SessionsView } from './SessionsView'
import { useSessionActions } from './use-session-actions'

type StatusFilter = 'all' | SessionStatus
type SortKey = 'updated-desc' | 'updated-asc' | 'started-desc' | 'started-asc'

export function SessionsPage() {
  const context = useConsoleContext()
  const actions = useSessionActions()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('updated-desc')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const sessions = useMemo(() => {
    const filtered = context.sessions.filter(
      (session) =>
        (status === 'all' || session.status === status) &&
        matchesSearch(
          [
            session.title,
            session.id,
            session.agentSnapshot.systemPrompt,
            session.agentSnapshot.model,
            session.environmentId,
            session.status,
            session.modelProvider,
          ],
          context.query,
        ),
    )
    return [...filtered].sort((a, b) => {
      const startedA = Date.parse(a.startedAt ?? a.createdAt)
      const startedB = Date.parse(b.startedAt ?? b.createdAt)
      const updatedA = Date.parse(a.updatedAt)
      const updatedB = Date.parse(b.updatedAt)
      if (sort === 'started-asc') return startedA - startedB
      if (sort === 'started-desc') return startedB - startedA
      if (sort === 'updated-asc') return updatedA - updatedB
      return updatedB - updatedA
    })
  }, [context.query, context.sessions, sort, status])
  const archiveSelected = () => {
    for (const id of selectedIds) actions.archiveSession(id)
    setSelectedIds([])
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sessions"
        description="Inspect runtime sessions and open a session to send messages, review events, or stop active work."
        actions={
          <Button type="button" onClick={() => context.openCreateSession()}>
            <MessageSquare data-icon="inline-start" />
            Create session
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {['pending', 'running', 'idle', 'stopped', 'error', 'archived', 'requires-action'].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated-desc">Recently updated</SelectItem>
            <SelectItem value="updated-asc">Oldest updated</SelectItem>
            <SelectItem value="started-desc">Recently started</SelectItem>
            <SelectItem value="started-asc">Oldest started</SelectItem>
          </SelectContent>
        </Select>
        <ConfirmAction
          title="Archive selected sessions?"
          description="Archive selected sessions from active operations while preserving persisted events."
          confirmLabel="Archive sessions"
          destructive
          onConfirm={archiveSelected}
        >
          <Button type="button" variant="outline" disabled={selectedIds.length === 0}>
            <Archive data-icon="inline-start" />
            Archive selected
          </Button>
        </ConfirmAction>
      </div>
      <SessionsView
        sessions={sessions}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        onArchive={actions.archiveSession}
      />
    </div>
  )
}
