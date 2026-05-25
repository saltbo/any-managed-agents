import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { EmptyState } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'
import { SessionDetailView } from './SessionDetailView'
import { usePiRuntimeSession } from './use-pi-runtime-session'
import { useSessionActions } from './use-session-actions'

export function SessionDetailPage() {
  const { sessionId } = useParams()
  const context = useConsoleContext()
  const queryClient = useQueryClient()
  const actions = useSessionActions()
  const [message, setMessage] = useState('')
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId ?? ''],
    queryFn: () => api.readSession(sessionId as string),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  })
  const session = sessionQuery.data ?? null
  const agent = session ? context.agents.find((item) => item.id === session.agentId) : null
  const environment = session?.environmentId
    ? context.environments.find((item) => item.id === session.environmentId)
    : null
  const refreshEvents = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['sessions', sessionId ?? '', 'events'] })
    void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
  }, [queryClient, sessionId])
  const runtime = usePiRuntimeSession({
    session: session && (session.status === 'idle' || session.status === 'running') ? session : null,
    events: context.sessionEvents,
    onEventsChanged: refreshEvents,
  })
  const sendMessage = runtime.state.runState === 'running' ? runtime.sendFollowUp : runtime.sendPrompt

  useEffect(() => {
    if (sessionId) context.setSelectedSessionId(sessionId)
  }, [context, sessionId])

  useEffect(() => {
    if (session && context.selectedSession !== session) context.setSelectedSession(session)
  }, [context, session])

  if (sessionQuery.isPending) return <EmptyState title="Loading session" body="Reading the requested session." />
  if (!session) return <EmptyState title="Session not found" body="The requested session is not in this project." />
  return (
    <div className="min-h-[calc(100dvh-8rem)]">
      <SessionDetailView
        session={session}
        agentName={agent?.name}
        environmentName={environment?.name}
        events={context.sessionEvents}
        runtime={runtime.state}
        onStop={actions.stopSession}
        onArchive={actions.archiveSession}
        onRefreshEvents={refreshEvents}
        chatMessage={message}
        setChatMessage={setMessage}
        onSendMessage={sendMessage}
        onAbortRuntime={runtime.abort}
      />
    </div>
  )
}
