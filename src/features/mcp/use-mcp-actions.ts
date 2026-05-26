import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useMcpActions() {
  const queryClient = useQueryClient()
  const disconnectMcpConnection = useMutation({
    mutationFn: api.disconnectMcpConnection,
    onSuccess: () => {
      toast.success('MCP connection disconnected')
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.all })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  return {
    disconnectMcpConnection: (id: string) => disconnectMcpConnection.mutate(id),
    disconnectMcpConnectionPending: disconnectMcpConnection.isPending,
  }
}
