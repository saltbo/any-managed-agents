import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { VaultDetailView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'
import { api } from '@/lib/api'

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
  return <VaultDetailView vault={vault} credentials={vaultId ? (context.vaultCredentials[vaultId] ?? []) : []} />
}
