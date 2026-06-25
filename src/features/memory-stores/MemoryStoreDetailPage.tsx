import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, PageHeader, TablePagination, TableSurface } from '@/console/components'
import { formatDate } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { api, type MemoryStoreMemory } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { MemoryEntrySheet } from './MemoryStoreForms'

export function MemoryStoreDetailPage() {
  const { storeId } = useParams()
  const queryClient = useQueryClient()
  const [editingMemory, setEditingMemory] = useState<MemoryStoreMemory | null>(null)
  const [entrySheetOpen, setEntrySheetOpen] = useState(false)
  const storeQuery = useQuery({
    queryKey: queryKeys.memoryStores.detail(storeId ?? ''),
    queryFn: () => api.readMemoryStore(storeId as string),
    enabled: Boolean(storeId),
  })
  const memoriesQuery = useQuery({
    queryKey: queryKeys.memoryStores.memories(storeId ?? ''),
    queryFn: () => api.listMemoryStoreMemories(storeId as string),
    enabled: Boolean(storeId),
  })
  const deleteMemory = useMutation({
    mutationFn: (memoryId: string) => api.deleteMemoryStoreMemory(storeId as string, memoryId),
    onSuccess: () => {
      toast.success('Memory deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryStores.memories(storeId ?? '') })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const store = storeQuery.data ?? null
  const memories = memoriesQuery.data?.data ?? []
  const pagination = useClientPagination(memories)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Memory Store"
        title={store?.name ?? 'Memory store detail'}
        description={store?.description ?? 'Manage reusable memory files mounted into sessions.'}
        actions={
          <Button
            type="button"
            onClick={() => {
              setEditingMemory(null)
              setEntrySheetOpen(true)
            }}
          >
            <Plus data-icon="inline-start" />
            Add memory
          </Button>
        }
      />
      {memories.length === 0 ? (
        <EmptyState title="No memories" body="Add a memory file to make this store useful in sessions." />
      ) : (
        <TableSurface
          tableId="memory-store-memories"
          viewportRef={pagination.viewportRef}
          footer={<TablePagination pagination={pagination} />}
        >
          <TableHeader>
            <TableRow>
              <TableHead>Path</TableHead>
              <TableHead>Content</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.items.map((memory) => (
              <TableRow key={memory.id}>
                <TableCell className="font-mono text-xs">{memory.path}</TableCell>
                <TableCell className="max-w-xl truncate text-sm text-muted-foreground">{memory.content}</TableCell>
                <TableCell>{formatDate(memory.updatedAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Edit memory"
                      onClick={() => {
                        setEditingMemory(memory)
                        setEntrySheetOpen(true)
                      }}
                    >
                      <Edit data-icon="inline-start" />
                    </Button>
                    <ConfirmAction
                      title="Delete memory?"
                      description={`Delete ${memory.path} from this memory store.`}
                      confirmLabel="Delete memory"
                      destructive
                      onConfirm={() => deleteMemory.mutate(memory.id)}
                    >
                      <Button type="button" variant="outline" size="icon" aria-label="Delete memory">
                        <Trash2 data-icon="inline-start" />
                      </Button>
                    </ConfirmAction>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableSurface>
      )}
      {storeId ? (
        <MemoryEntrySheet
          storeId={storeId}
          memory={editingMemory}
          open={entrySheetOpen}
          onOpenChange={(open) => {
            setEntrySheetOpen(open)
            if (!open) setEditingMemory(null)
          }}
        />
      ) : null}
    </div>
  )
}
