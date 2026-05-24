import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { EnvironmentDetailView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'

export function EnvironmentDetailPage() {
  const { environmentId } = useParams()
  const context = useConsoleContext()
  const listEnvironment = context.environments.find((item) => item.id === environmentId)
  const environmentQuery = useQuery({
    queryKey: ['environment', environmentId ?? ''],
    queryFn: () => api.readEnvironment(environmentId as string),
    enabled: Boolean(environmentId),
    ...(listEnvironment ? { placeholderData: listEnvironment } : {}),
  })
  const environment = environmentQuery.data ?? null
  return (
    <EnvironmentDetailView
      environment={environment}
      agents={context.agents}
      sessions={context.sessions}
      onArchive={context.archiveEnvironment}
    />
  )
}
