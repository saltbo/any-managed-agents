import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useVaultActions() {
  const queryClient = useQueryClient()
  const archiveVault = useMutation({
    mutationFn: api.archiveVault,
    onSuccess: () => {
      toast.success('Vault archived')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    archiveVault: (id: string) => archiveVault.mutate(id),
    archiveVaultPending: archiveVault.isPending,
  }
}
