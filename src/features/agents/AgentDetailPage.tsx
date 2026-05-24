import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { AgentDetailView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'

export function AgentDetailPage() {
  const { agentId } = useParams()
  const context = useConsoleContext()
  const listAgent = context.agents.find((item) => item.id === agentId)
  const agentQuery = useQuery({
    queryKey: ['agent', agentId ?? ''],
    queryFn: () => api.readAgent(agentId as string),
    enabled: Boolean(agentId),
    ...(listAgent ? { placeholderData: listAgent } : {}),
  })
  const agent = agentQuery.data ?? null
  return (
    <AgentDetailView
      agent={agent}
      environments={context.environments}
      sessions={context.sessions}
      onStartSession={context.startSession}
      onArchive={context.archiveAgent}
    />
  )
}
