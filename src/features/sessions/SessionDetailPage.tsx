import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useParams } from 'react-router'
import { EmptyState } from '@/console/components'
import { SessionDetailView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'

export function SessionDetailPage() {
  const { sessionId } = useParams()
  const context = useConsoleContext()
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId ?? ''],
    queryFn: () => api.readSession(sessionId as string),
    enabled: Boolean(sessionId),
  })
  const session = sessionQuery.data ?? null

  useEffect(() => {
    if (sessionId) context.setSelectedSessionId(sessionId)
  }, [context, sessionId])

  useEffect(() => {
    if (session && context.selectedSession !== session) context.setSelectedSession(session)
  }, [context, session])

  if (sessionQuery.isPending) return <EmptyState title="Loading session" body="Reading the requested session." />
  if (!session) return <EmptyState title="Session not found" body="The requested session is not in this project." />
  return (
    <SessionDetailView
      session={session}
      events={context.sessionEvents}
      runtimeTranscript={context.runtimeTranscript}
      onStop={context.stopSession}
      onArchive={context.archiveSession}
      onRefreshEvents={context.refreshEvents}
      taskMessage={context.taskMessage}
      setTaskMessage={context.setTaskMessage}
      onSendTask={(event) => {
        event.preventDefault()
        context.sendTask()
      }}
    />
  )
}
