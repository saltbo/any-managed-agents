import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useEnvironmentActions() {
  const queryClient = useQueryClient()
  const archiveEnvironment = useMutation({
    mutationFn: api.archiveEnvironment,
    onSuccess: () => {
      toast.success('Environment archived')
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    archiveEnvironment: (id: string) => archiveEnvironment.mutate(id),
    archiveEnvironmentPending: archiveEnvironment.isPending,
  }
}
