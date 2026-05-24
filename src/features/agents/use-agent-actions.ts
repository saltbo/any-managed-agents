import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export function useAgentActions() {
  const queryClient = useQueryClient()
  const archiveAgent = useMutation({
    mutationFn: api.archiveAgent,
    onSuccess: () => {
      toast.success('Agent archived')
      void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  return {
    archiveAgent: (id: string) => archiveAgent.mutate(id),
    archiveAgentPending: archiveAgent.isPending,
  }
}
