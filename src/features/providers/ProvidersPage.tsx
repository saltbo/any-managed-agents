import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { CreateProviderSheet } from './CreateProviderSheet'
import { ProvidersView } from './ProvidersView'
import { useProviderActions } from './use-provider-actions'

export function ProvidersPage() {
  const [creating, setCreating] = useState(false)
  const actions = useProviderActions()
  const providersQuery = useQuery({
    queryKey: queryKeys.providers.list(false),
    queryFn: () => api.listProviders(false),
  })
  const providers = providersQuery.data?.data ?? []
  const pagination = useClientPagination(providers)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Providers"
        description="Manage model provider configuration, default routing, credentials, and catalog readiness."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <ShieldCheck data-icon="inline-start" />
            Create provider
          </Button>
        }
      />
      <ProvidersView providers={pagination.items} pagination={pagination} onArchive={actions.archiveProvider} />
      <CreateProviderSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
