import { useQuery } from '@tanstack/react-query'
import { EmptyState, PageHeader } from '@/console/components'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { QuickstartView } from './QuickstartView'

export function QuickstartPage() {
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(false),
    queryFn: () => api.listAgents(),
  })
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(false),
    queryFn: () => api.listEnvironments(),
  })
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(false),
    queryFn: () => api.listSessions(),
  })
  const error = agentsQuery.error ?? environmentsQuery.error ?? sessionsQuery.error
  if (error) {
    return (
      <EmptyState
        title={error instanceof Error ? error.message : String(error)}
        body="Unable to load quickstart resources."
      />
    )
  }
  if (agentsQuery.isPending || environmentsQuery.isPending || sessionsQuery.isPending) {
    return <EmptyState title="Loading quickstart" body="Reading setup resources for this project." />
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Quickstart"
        description="Complete the minimum setup path for creating a session and sending the first runtime message."
      />
      <QuickstartView
        agents={agentsQuery.data?.data ?? []}
        environments={environmentsQuery.data?.data ?? []}
        sessions={sessionsQuery.data?.data ?? []}
      />
    </div>
  )
}
