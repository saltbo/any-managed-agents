import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, PageHeader, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

// Read-only view of the platform's GLOBAL model catalog: the vendors and models
// discovered from Workers AI + models.dev that agents can pin. There is no
// per-tenant provider config anymore — the catalog is refreshed by discovery.
export function ProvidersPage() {
  const queryClient = useQueryClient()
  const modelsQuery = useQuery({
    queryKey: queryKeys.providers.models,
    queryFn: () => api.listModels(),
  })
  const models = modelsQuery.data?.data ?? []
  const pagination = useClientPagination(models)
  const refresh = useMutation({
    mutationFn: () => api.refreshCatalog(),
    onSuccess: (result) => {
      toast.success(`Catalog refreshed — ${result.discoveredCount} models across ${result.vendors} vendors`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Providers"
        title="Model catalog"
        description="The platform's global model vendors and models, discovered from Workers AI and models.dev. Pin one on an agent to run it."
        actions={
          <Button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw data-icon="inline-start" />
            Refresh catalog
          </Button>
        }
      />
      {modelsQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : models.length === 0 ? (
        <EmptyState
          title="No models yet"
          body="The catalog is empty. Refresh to discover models from Workers AI and models.dev."
        />
      ) : (
        <TableSurface viewportRef={pagination.viewportRef} footer={<TablePagination pagination={pagination} />}>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead>Context</TableHead>
              <TableHead>Availability</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.items.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="max-w-40 break-all">{model.providerId}</TableCell>
                <TableCell className="max-w-64 break-all">{model.modelId}</TableCell>
                <TableCell className="max-w-48 truncate">{model.capabilities.join(', ') || '—'}</TableCell>
                <TableCell>{model.contextWindow ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge value={model.availability} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableSurface>
      )}
    </div>
  )
}
