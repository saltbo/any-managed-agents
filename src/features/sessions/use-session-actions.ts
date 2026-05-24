import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useConsoleContext } from '@/features/console/console-context'
import { api, type Session } from '@/lib/api'

export function useSessionActions() {
  const queryClient = useQueryClient()
  const context = useConsoleContext()

  const stopSession = useMutation({
    mutationFn: api.stopSession,
    onSuccess: (session: Session) => {
      context.setSelectedSession(session)
      queryClient.setQueryData(['session', session.id], session)
      toast.success('Session stopped')
      void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const archiveSession = useMutation({
    mutationFn: api.archiveSession,
    onSuccess: () => {
      toast.success('Session archived')
      void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  return {
    stopSession: (id: string) => stopSession.mutate(id),
    archiveSession: (id: string) => archiveSession.mutate(id),
    stopSessionPending: stopSession.isPending,
    archiveSessionPending: archiveSession.isPending,
  }
}
