import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Session } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useSessionActions() {
  const queryClient = useQueryClient()

  const stopSession = useMutation({
    mutationFn: api.stopSession,
    onSuccess: (session: Session) => {
      queryClient.setQueryData(queryKeys.sessions.detail(session.id), session)
      toast.success('Session stopped')
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const archiveSession = useMutation({
    mutationFn: api.archiveSession,
    onSuccess: () => {
      toast.success('Session archived')
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
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
