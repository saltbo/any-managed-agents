import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Brain } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, PageHeader, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { archivedLabel, formatDate } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { CreateMemoryStoreSheet } from './MemoryStoreForms'

export function MemoryStoresPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const storesQuery = useQuery({
    queryKey: queryKeys.memoryStores.list(false),
    queryFn: () => api.listMemoryStores(),
  })
  const archiveStore = useMutation({
    mutationFn: (id: string) => api.archiveMemoryStore(id),
    onSuccess: () => {
      toast.success('Memory store archived')
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryStores.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const stores = storesQuery.data?.data ?? []
  const pagination = useClientPagination(stores)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Memory Stores"
        description="Manage reusable session-mounted memory files."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Brain data-icon="inline-start" />
            Create store
          </Button>
        }
      />
      {stores.length === 0 ? (
        <EmptyState title="No memory stores" body="Create a memory store to attach reusable files to sessions." />
      ) : (
        <TableSurface
          tableId="memory-stores"
          viewportRef={pagination.viewportRef}
          footer={<TablePagination pagination={pagination} />}
        >
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.items.map((store) => (
              <TableRow key={store.id}>
                <TableCell className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link className="truncate font-medium hover:underline" to={`/memory-stores/${store.id}`}>
                      {store.name}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">{store.description ?? store.id}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge value={archivedLabel(store)} />
                </TableCell>
                <TableCell>{formatDate(store.createdAt)}</TableCell>
                <TableCell>{formatDate(store.updatedAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <ConfirmAction
                      title="Archive memory store?"
                      description={`Archive ${store.name}. Existing sessions keep their snapshots.`}
                      confirmLabel="Archive store"
                      destructive
                      onConfirm={() => archiveStore.mutate(store.id)}
                    >
                      <Button type="button" variant="outline" size="icon" aria-label="Archive memory store">
                        <Archive data-icon="inline-start" />
                      </Button>
                    </ConfirmAction>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableSurface>
      )}
      <CreateMemoryStoreSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
