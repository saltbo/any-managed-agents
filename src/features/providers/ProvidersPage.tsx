import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useConsoleContext } from '@/features/console/console-context'
import { ProvidersView } from './ProvidersView'
import { useProviderActions } from './use-provider-actions'

export function ProvidersPage() {
  const context = useConsoleContext()
  const actions = useProviderActions()
  const providers = context.providers.filter((provider) =>
    matchesSearch([provider.displayName, provider.type, provider.status], context.query),
  )
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
      <ProvidersView providers={providers} onArchive={actions.archiveProvider} />
    </div>
  )
}
