import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useParams } from 'react-router'
import { EmptyState } from '@/console/components'
import { api, type EventRecordListResponse } from '@/lib/amarpc'
import { queryKeys } from '@/lib/query-keys'
import { SessionDetailView } from './SessionDetailView'
import { useSessionActions } from './use-session-actions'
import { useSessionRuntimeSession } from './use-session-runtime'

const EMPTY_EVENTS: never[] = []
const SESSION_EVENT_PAGE_LIMIT = 200

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
    queryFn: () => listSessionEventHistory(sessionId as string),
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
  const sendMessage = useCallback(
    (content: string) => {
      if (!sessionId) return
      void api
        .sendSessionMessage(sessionId, content)
        .then(refreshEvents)
        .catch(() => {
          if (!runtime.sendPrompt(content)) {
            refreshEvents()
          }
        })
    },
    [refreshEvents, runtime, sessionId],
  )

  if (sessionQuery.isPending) return <EmptyState title="Loading session" body="Reading the requested session." />
  if (!session) return <EmptyState title="Session not found" body="The requested session is not in this project." />
  return (
    <div className="min-h-[calc(100dvh-8rem)]">
      <SessionDetailView
        session={session}
        agentName={agentQuery.data?.metadata.name}
        environmentName={environmentQuery.data?.metadata.name}
        events={eventsQuery.data?.data ?? EMPTY_EVENTS}
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

async function listSessionEventHistory(sessionId: string): Promise<EventRecordListResponse> {
  const data: EventRecordListResponse['data'] = []
  let cursor: number | undefined
  let pagination: EventRecordListResponse['pagination'] = {
    limit: SESSION_EVENT_PAGE_LIMIT,
    nextCursor: null,
    hasMore: false,
  }

  for (;;) {
    const page = await api.listSessionEvents(sessionId, {
      limit: SESSION_EVENT_PAGE_LIMIT,
      order: 'asc',
      ...(cursor === undefined ? {} : { cursor }),
    })
    data.push(...page.data)
    pagination = page.pagination

    if (!page.pagination.hasMore) {
      return { data, pagination }
    }

    if (!page.pagination.nextCursor) {
      throw new Error('Session events page is missing nextCursor')
    }

    const nextCursor = Number(page.pagination.nextCursor)
    if (!Number.isSafeInteger(nextCursor)) {
      throw new Error(`Session events page returned invalid nextCursor: ${page.pagination.nextCursor}`)
    }
    cursor = nextCursor
  }
}
