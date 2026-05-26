import { useQuery } from '@tanstack/react-query'
import { Archive, MessageSquare } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmAction, EmptyState, PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api, type SessionStatus } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { CreateSessionSheet } from './CreateSessionSheet'
import { SessionsView } from './SessionsView'
import { useSessionActions } from './use-session-actions'

type StatusFilter = 'all' | SessionStatus
type SortKey = 'updated-desc' | 'updated-asc' | 'started-desc' | 'started-asc'

export function SessionsPage() {
  const actions = useSessionActions()
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('updated-desc')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(false),
    queryFn: () => api.listSessions(false),
    refetchInterval: (query) => (query.state.data?.data.some((session) => session.status === 'pending') ? 2000 : false),
  })
  const sessions = useMemo(() => {
    const filtered = (sessionsQuery.data?.data ?? []).filter((session) => status === 'all' || session.status === status)
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
  }, [sessionsQuery.data?.data, sort, status])
  const pagination = useClientPagination(sessions)
  const archiveSelected = () => {
    for (const id of selectedIds) actions.archiveSession(id)
    setSelectedIds([])
  }
  if (sessionsQuery.error) {
    return (
      <EmptyState
        title="Sessions unavailable"
        body={sessionsQuery.error instanceof Error ? sessionsQuery.error.message : String(sessionsQuery.error)}
      />
    )
  }
  if (sessionsQuery.isPending) {
    return <EmptyState title="Loading sessions" body="Reading runtime sessions for this project." />
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sessions"
        description="Inspect runtime sessions and open a session to send messages, review events, or stop active work."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
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
        sessions={pagination.items}
        pagination={pagination}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        onArchive={actions.archiveSession}
      />
      <CreateSessionSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
