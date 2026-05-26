import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageHeader } from '@/console/components'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { VaultDetailView } from './VaultDetailView'

export function VaultDetailPage() {
  const { vaultId } = useParams()
  const vaultQuery = useQuery({
    queryKey: queryKeys.vaults.detail(vaultId ?? ''),
    queryFn: () => api.readVault(vaultId as string),
    enabled: Boolean(vaultId),
  })
  const credentialsQuery = useQuery({
    queryKey: queryKeys.vaults.credentials(vaultId ?? '', false),
    queryFn: () => api.listVaultCredentials(vaultId as string, false),
    enabled: Boolean(vaultId),
  })
  const vault = vaultQuery.data ?? null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Vault"
        title={vault?.name ?? 'Vault detail'}
        description={vault?.description ?? 'Inspect credential metadata and safe reference state.'}
      />
      <VaultDetailView vault={vault} credentials={credentialsQuery.data?.data ?? []} />
    </div>
  )
}
