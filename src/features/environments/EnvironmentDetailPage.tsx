import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageHeader } from '@/console/components'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { EnvironmentDetailView } from './EnvironmentDetailView'
import { useEnvironmentActions } from './use-environment-actions'

export function EnvironmentDetailPage() {
  const { environmentId } = useParams()
  const actions = useEnvironmentActions()
  const environmentQuery = useQuery({
    queryKey: queryKeys.environments.detail(environmentId ?? ''),
    queryFn: () => api.readEnvironment(environmentId as string),
    enabled: Boolean(environmentId),
  })
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(false),
    queryFn: () => api.listSessions(),
  })
  const environment = environmentQuery.data ?? null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Environment"
        title={environment?.name ?? 'Environment detail'}
        description={environment?.description ?? 'Inspect hosting mode, runtime, runtime config, policy, and bindings.'}
      />
      <EnvironmentDetailView
        environment={environment}
        sessions={sessionsQuery.data?.data ?? []}
        onArchive={actions.archiveEnvironment}
      />
    </div>
  )
}
