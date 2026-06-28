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
    /* v8 ignore start -- refetchInterval is a React Query internal callback */
    refetchInterval: (query) => (query.state.data?.status.phase === 'pending' ? 2000 : false),
    /* v8 ignore stop */
  })
  const session = sessionQuery.data ?? null
  const agentQuery = useQuery({
    queryKey: queryKeys.agents.detail(session?.spec.agentId ?? ''),
    /* v8 ignore start -- queryFn only runs when enabled=true (agentId is truthy), so `?? ''` fallback is unreachable */
    queryFn: () => api.readAgent(session?.spec.agentId ?? ''),
    /* v8 ignore stop */
    enabled: Boolean(session?.spec.agentId),
  })
  const environmentQuery = useQuery({
    queryKey: queryKeys.environments.detail(session?.spec.environmentId ?? ''),
    /* v8 ignore start -- queryFn only runs when enabled=true (environmentId is truthy), so `?? ''` fallback is unreachable */
    queryFn: () => api.readEnvironment(session?.spec.environmentId ?? ''),
    /* v8 ignore stop */
    enabled: Boolean(session?.spec.environmentId),
  })
  const eventsQuery = useQuery({
    queryKey: queryKeys.sessions.events(sessionId ?? ''),
    queryFn: () => api.listSessionEvents(sessionId as string, { limit: 200, order: 'desc' }),
    enabled: Boolean(sessionId),
  })
  const refreshEvents = useCallback(() => {
    /* v8 ignore start -- sessionId is always defined when refreshEvents is invoked; `?? ''` fallbacks are unreachable */
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.events(sessionId ?? '') })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId ?? '') })
    /* v8 ignore stop */
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
