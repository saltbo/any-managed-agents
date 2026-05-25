import { Archive } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Vault } from '@/lib/api'

export function VaultsView({
  vaults,
  pagination,
  onArchive,
}: {
  vaults: Vault[]
  pagination: ClientPagination<Vault>
  onArchive: (id: string) => void
}) {
  if (vaults.length === 0) {
    return (
      <EmptyState title="No vaults" body="Create a vault to track safe credential references for providers and MCP." />
    )
  }
  return (
    <TableSurface viewportRef={pagination.viewportRef} footer={<TablePagination pagination={pagination} />}>
      <TableHeader>
        <TableRow>
          <TableHead>Vault</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vaults.map((vault) => (
          <TableRow key={vault.id}>
            <TableCell className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link className="truncate font-medium hover:underline" to={`/vaults/${vault.id}`}>
                  {vault.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">{vault.description ?? vault.id}</span>
              </div>
            </TableCell>
            <TableCell>
              <StatusBadge value={vault.status} />
            </TableCell>
            <TableCell>
              <StatusBadge value={vault.scope} />
            </TableCell>
            <TableCell className="max-w-48 truncate">{vault.projectId ?? 'Organization'}</TableCell>
            <TableCell>{formatDate(vault.createdAt)}</TableCell>
            <TableCell>{formatDate(vault.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end">
                <ConfirmAction
                  title="Archive vault?"
                  description={`Archive ${vault.name}. Existing credential references remain auditable.`}
                  confirmLabel="Archive vault"
                  destructive
                  onConfirm={() => onArchive(vault.id)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive vault">
                    <Archive data-icon="inline-start" />
                  </Button>
                </ConfirmAction>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
