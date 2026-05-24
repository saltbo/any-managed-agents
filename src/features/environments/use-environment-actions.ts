import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export function useEnvironmentActions() {
  const queryClient = useQueryClient()
  const archiveEnvironment = useMutation({
    mutationFn: api.archiveEnvironment,
    onSuccess: () => {
      toast.success('Environment archived')
      void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  return {
    archiveEnvironment: (id: string) => archiveEnvironment.mutate(id),
    archiveEnvironmentPending: archiveEnvironment.isPending,
  }
}
