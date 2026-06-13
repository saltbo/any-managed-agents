import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type CreateConnectionInput } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useMcpActions() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.connections.all })
  const disconnectMcpConnection = useMutation({
    mutationFn: api.disconnectConnection,
    onSuccess: () => {
      toast.success('MCP connection disconnected')
      void invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const connectMcpConnector = useMutation({
    mutationFn: api.createConnection,
    onSuccess: () => {
      toast.success('MCP connector connected')
      void invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  return {
    disconnectMcpConnection: (id: string) => disconnectMcpConnection.mutate(id),
    disconnectMcpConnectionPending: disconnectMcpConnection.isPending,
    connectMcpConnector: (input: CreateConnectionInput) => connectMcpConnector.mutate(input),
    connectMcpConnectorPending: connectMcpConnector.isPending,
  }
}
