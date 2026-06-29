import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useAgentActions() {
  const queryClient = useQueryClient()
  const archiveAgent = useMutation({
    mutationFn: api.archiveAgent,
    onSuccess: () => {
      toast.success('Agent archived')
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    archiveAgent: (id: string) => archiveAgent.mutate(id),
    archiveAgentPending: archiveAgent.isPending,
  }
}
