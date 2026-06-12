import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/console/components'
import { api, type VaultCredential } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { AddCredentialSheet } from './AddCredentialSheet'
import { RotateCredentialSheet } from './RotateCredentialSheet'
import { VaultDetailView } from './VaultDetailView'

export function VaultDetailPage() {
  const { vaultId } = useParams()
  const queryClient = useQueryClient()
  const [addingCredential, setAddingCredential] = useState(false)
  const [rotatingCredential, setRotatingCredential] = useState<VaultCredential | null>(null)
  const vaultQuery = useQuery({
    queryKey: queryKeys.vaults.detail(vaultId ?? ''),
    queryFn: () => api.readVault(vaultId as string),
    enabled: Boolean(vaultId),
  })
  const credentialsQuery = useQuery({
    queryKey: queryKeys.vaults.credentials(vaultId ?? '', true),
    queryFn: () => api.listVaultCredentials(vaultId as string, { includeArchived: true }),
    enabled: Boolean(vaultId),
  })
  const auditQuery = useQuery({
    queryKey: queryKeys.vaults.audit(vaultId ?? ''),
    queryFn: async () => {
      const [vaultRecords, credentialRecords] = await Promise.all([
        api.listAuditRecords({ resourceType: 'vault', resourceId: vaultId as string }),
        api.listAuditRecords({ resourceType: 'vault_credential' }),
      ])
      return [
        ...vaultRecords.data,
        ...credentialRecords.data.filter((record) => record.metadata.vaultId === vaultId),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },
    enabled: Boolean(vaultId),
  })
  const revokeCredential = useMutation({
    mutationFn: (credential: VaultCredential) => api.revokeVaultCredential(vaultId as string, credential.id),
    onSuccess: () => {
      toast.success('Credential revoked')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.detail(vaultId ?? '') })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const vault = vaultQuery.data ?? null
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Vault"
        title={vault?.name ?? 'Vault detail'}
        description={vault?.description ?? 'Inspect credential metadata and safe reference state.'}
      />
      <VaultDetailView
        vault={vault}
        credentials={credentialsQuery.data?.data ?? []}
        auditRecords={auditQuery.data ?? []}
        loading={vaultQuery.isLoading}
        onAddCredential={() => setAddingCredential(true)}
        onRotate={(credential) => setRotatingCredential(credential)}
        onRevoke={(credential) => revokeCredential.mutate(credential)}
      />
      {vaultId ? (
        <>
          <AddCredentialSheet vaultId={vaultId} open={addingCredential} onOpenChange={setAddingCredential} />
          <RotateCredentialSheet
            vaultId={vaultId}
            credential={rotatingCredential}
            onOpenChange={(open) => {
              if (!open) setRotatingCredential(null)
            }}
          />
        </>
      ) : null}
    </div>
  )
}
