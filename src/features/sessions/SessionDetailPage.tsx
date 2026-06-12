import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useParams } from 'react-router'
import { EmptyState } from '@/console/components'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { SessionDetailView } from './SessionDetailView'
import { useSessionActions } from './use-session-actions'
import { useSessionRuntimeSession } from './use-session-runtime'

const EMPTY_EVENTS: never[] = []

export function SessionDetailPage() {
  const { sessionId } = useParams()
  const queryClient = useQueryClient()
  const actions = useSessionActions()
  const [message, setMessage] = useState('')
  const sessionQuery = useQuery({
    queryKey: queryKeys.sessions.detail(sessionId ?? ''),
    queryFn: () => api.readSession(sessionId as string),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  })
  const session = sessionQuery.data ?? null
  const agentQuery = useQuery({
    queryKey: queryKeys.agents.detail(session?.agentId ?? ''),
    queryFn: () => api.readAgent(session?.agentId ?? ''),
    enabled: Boolean(session?.agentId),
  })
  const environmentQuery = useQuery({
    queryKey: queryKeys.environments.detail(session?.environmentId ?? ''),
    queryFn: () => api.readEnvironment(session?.environmentId ?? ''),
    enabled: Boolean(session?.environmentId),
  })
  const eventsQuery = useQuery({
    queryKey: queryKeys.sessions.events(sessionId ?? ''),
    queryFn: () => api.listSessionEvents(sessionId as string, { limit: 200, order: 'desc' }),
    enabled: Boolean(sessionId),
  })
  const refreshEvents = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.events(sessionId ?? '') })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId ?? '') })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
  }, [queryClient, sessionId])
  const runtime = useSessionRuntimeSession({
    session,
    events: eventsQuery.data?.data ?? EMPTY_EVENTS,
    onEventsChanged: refreshEvents,
  })

  if (sessionQuery.isPending) return <EmptyState title="Loading session" body="Reading the requested session." />
  if (!session) return <EmptyState title="Session not found" body="The requested session is not in this project." />
  return (
    <div className="min-h-[calc(100dvh-8rem)]">
      <SessionDetailView
        session={session}
        agentName={agentQuery.data?.name}
        environmentName={environmentQuery.data?.name}
        events={eventsQuery.data?.data ?? EMPTY_EVENTS}
        runtime={runtime.state}
        onStop={actions.stopSession}
        onArchive={actions.archiveSession}
        onRefreshEvents={refreshEvents}
        chatMessage={message}
        setChatMessage={setMessage}
        onSendMessage={runtime.sendPrompt}
        onAbortRuntime={runtime.abort}
      />
    </div>
  )
}
