import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageHeader } from '@/console/components'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { ProviderDetailView } from './ProviderDetailView'

export function ProviderDetailPage() {
  const { providerId } = useParams()
  const providerQuery = useQuery({
    queryKey: queryKeys.providers.detail(providerId ?? ''),
    queryFn: () => api.readProvider(providerId as string),
    enabled: Boolean(providerId),
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
