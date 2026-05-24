import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { ProviderDetailView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'

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
  return <ProviderDetailView provider={provider} />
}
