import { ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { useConsoleContext } from '@/features/console/console-context'
import { ProvidersView } from './ProvidersView'
import { useProviderActions } from './use-provider-actions'

export function ProvidersPage() {
  const context = useConsoleContext()
  const actions = useProviderActions()
  const providers = useMemo(
    () =>
      context.providers.filter((provider) =>
        matchesSearch([provider.displayName, provider.type, provider.status], context.query),
      ),
    [context.providers, context.query],
  )
  const pagination = useClientPagination(providers)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Providers"
        description="Manage model provider configuration, default routing, credentials, and catalog readiness."
        actions={
          <Button type="button" onClick={context.openCreateProvider}>
            <ShieldCheck data-icon="inline-start" />
            Create provider
          </Button>
        }
      />
      <ProvidersView providers={pagination.items} pagination={pagination} onArchive={actions.archiveProvider} />
    </div>
  )
}
