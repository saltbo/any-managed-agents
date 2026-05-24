import { matchesSearch } from '@/console/format'
import { ProvidersView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function ProvidersPage() {
  const context = useConsoleContext()
  const providers = context.providers.filter((provider) =>
    matchesSearch([provider.displayName, provider.type, provider.status], context.query),
  )
  return <ProvidersView providers={providers} onArchive={context.archiveProvider} />
}
