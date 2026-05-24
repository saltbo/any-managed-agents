import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export function useProviderActions() {
  const queryClient = useQueryClient()
  const archiveProvider = useMutation({
    mutationFn: api.archiveProvider,
    onSuccess: () => {
      toast.success('Provider deleted')
      void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  return {
    archiveProvider: (id: string) => archiveProvider.mutate(id),
    archiveProviderPending: archiveProvider.isPending,
  }
}
