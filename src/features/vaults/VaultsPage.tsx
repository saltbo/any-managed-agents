import { matchesSearch } from '@/console/format'
import { VaultsView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function VaultsPage() {
  const context = useConsoleContext()
  const vaults = context.vaults.filter((vault) =>
    matchesSearch([vault.name, vault.description, vault.scope, vault.status], context.query),
  )
  return <VaultsView vaults={vaults} onArchive={context.archiveVault} />
}
