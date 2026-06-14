import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useProviderActions() {
  const queryClient = useQueryClient()
  const archiveProvider = useMutation({
    mutationFn: api.deleteProvider,
    onSuccess: () => {
      toast.success('Provider deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    archiveProvider: (id: string) => archiveProvider.mutate(id),
    archiveProviderPending: archiveProvider.isPending,
  }
}
