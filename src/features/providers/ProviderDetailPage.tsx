import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageHeader } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'
import { ProviderDetailView } from './ProviderDetailView'

export function ProviderDetailPage() {
  const { providerId } = useParams()
  const context = useConsoleContext()
  const listProvider = context.providers.find((item) => item.id === providerId)
  const providerQuery = useQuery({
    queryKey: ['provider', providerId ?? ''],
    queryFn: () => api.readProvider(providerId as string),
    enabled: Boolean(providerId),
    ...(listProvider ? { placeholderData: listProvider } : {}),
  })
  const provider = providerQuery.data ?? null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Provider"
        title={provider?.displayName ?? 'Provider detail'}
        description="Inspect credential status, policy metadata, rate limits, and model catalog state."
      />
      <ProviderDetailView provider={provider} />
    </div>
  )
}
