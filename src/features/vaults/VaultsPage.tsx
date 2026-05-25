import { Vault } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { useConsoleContext } from '@/features/console/console-context'
import { useVaultActions } from './use-vault-actions'
import { VaultsView } from './VaultsView'

export function VaultsPage() {
  const context = useConsoleContext()
  const actions = useVaultActions()
  const vaults = useMemo(
    () =>
      context.vaults.filter((vault) =>
        matchesSearch([vault.name, vault.description, vault.scope, vault.status], context.query),
      ),
    [context.vaults, context.query],
  )
  const pagination = useClientPagination(vaults)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vaults"
        description="Track safe credential-reference metadata for providers, MCP connections, and runtime use."
        actions={
          <Button type="button" onClick={context.openCreateVault}>
            <Vault data-icon="inline-start" />
            Create vault
          </Button>
        }
      />
      <VaultsView vaults={pagination.items} pagination={pagination} onArchive={actions.archiveVault} />
    </div>
  )
}
