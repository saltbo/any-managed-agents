import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function useTriggerActions() {
  const queryClient = useQueryClient()
  const pauseTrigger = useMutation({
    mutationFn: (id: string) => api.updateTrigger(id, { enabled: false }),
    onSuccess: () => {
      toast.success('Trigger paused')
      void queryClient.invalidateQueries({ queryKey: queryKeys.triggers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const resumeTrigger = useMutation({
    mutationFn: (id: string) => api.updateTrigger(id, { enabled: true }),
    onSuccess: () => {
      toast.success('Trigger resumed')
      void queryClient.invalidateQueries({ queryKey: queryKeys.triggers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return {
    pauseTrigger: (id: string) => pauseTrigger.mutate(id),
    pauseTriggerPending: pauseTrigger.isPending,
    resumeTrigger: (id: string) => resumeTrigger.mutate(id),
    resumeTriggerPending: resumeTrigger.isPending,
  }
}
