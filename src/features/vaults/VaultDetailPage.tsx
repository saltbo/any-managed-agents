import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageHeader } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'
import { VaultDetailView } from './VaultDetailView'

export function VaultDetailPage() {
  const { vaultId } = useParams()
  const context = useConsoleContext()
  const listVault = context.vaults.find((item) => item.id === vaultId)
  const vaultQuery = useQuery({
    queryKey: ['vault', vaultId ?? ''],
    queryFn: () => api.readVault(vaultId as string),
    enabled: Boolean(vaultId),
    ...(listVault ? { placeholderData: listVault } : {}),
  })
  const vault = vaultQuery.data ?? null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Vault"
        title={vault?.name ?? 'Vault detail'}
        description={vault?.description ?? 'Inspect credential metadata and safe reference state.'}
      />
      <VaultDetailView vault={vault} credentials={vaultId ? (context.vaultCredentials[vaultId] ?? []) : []} />
    </div>
  )
}
