import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageHeader } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'
import { EnvironmentDetailView } from './EnvironmentDetailView'
import { useEnvironmentActions } from './use-environment-actions'

export function EnvironmentDetailPage() {
  const { environmentId } = useParams()
  const context = useConsoleContext()
  const actions = useEnvironmentActions()
  const listEnvironment = context.environments.find((item) => item.id === environmentId)
  const environmentQuery = useQuery({
    queryKey: ['environment', environmentId ?? ''],
    queryFn: () => api.readEnvironment(environmentId as string),
    enabled: Boolean(environmentId),
    ...(listEnvironment ? { placeholderData: listEnvironment } : {}),
  })
  const environment = environmentQuery.data ?? null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Environment"
        title={environment?.name ?? 'Environment detail'}
        description={environment?.description ?? 'Inspect runtime image, package policy, network policy, and bindings.'}
      />
      <EnvironmentDetailView
        environment={environment}
        sessions={context.sessions}
        onArchive={actions.archiveEnvironment}
      />
    </div>
  )
}
