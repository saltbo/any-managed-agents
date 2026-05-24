import { Archive } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TableSurface } from '@/console/components'
import { formatDate } from '@/console/format'
import type { Provider } from '@/lib/api'

export function ProvidersView({ providers, onArchive }: { providers: Provider[]; onArchive: (id: string) => void }) {
  if (providers.length === 0) {
    return (
      <EmptyState
        title="No providers"
        body="Add a model provider or use the platform defaults discovered by the API."
      />
    )
  }
  return (
    <TableSurface>
      <TableHeader>
        <TableRow>
          <TableHead>Provider</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Credential</TableHead>
          <TableHead>Model catalog</TableHead>
          <TableHead>Base URL</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {providers.map((provider) => (
          <TableRow key={provider.id}>
            <TableCell className="min-w-56">
              <Link className="font-medium hover:underline" to={`/providers/${provider.id}`}>
                {provider.displayName}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{provider.type}</p>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <StatusBadge value={provider.status} />
                {provider.isDefault ? <StatusBadge value="default" /> : null}
              </div>
            </TableCell>
            <TableCell>
              <StatusBadge value={provider.credentialStatus} />
            </TableCell>
            <TableCell>{provider.modelCatalogStatus}</TableCell>
            <TableCell className="max-w-64 truncate">{provider.baseUrl ?? 'Platform default'}</TableCell>
            <TableCell>{formatDate(provider.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end">
                <ConfirmAction
                  title="Delete provider?"
                  description={`Delete ${provider.displayName}. Future agents cannot use this provider unless it is restored.`}
                  confirmLabel="Delete provider"
                  destructive
                  onConfirm={() => onArchive(provider.id)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Delete provider">
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
