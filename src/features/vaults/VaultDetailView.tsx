import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DetailSection, EmptyState, Meta, MetaGrid, StatusBadge, TableEmpty, TableSurface } from '@/console/components'
import { formatDate, stringifyJson } from '@/console/format'
import type { Vault, VaultCredential } from '@/lib/api'

export function VaultDetailView({ vault, credentials }: { vault: Vault | null; credentials: VaultCredential[] }) {
  if (!vault) return <EmptyState title="Vault not found" body="The requested vault is not in this project." />
  return (
    <div className="grid gap-4">
      <DetailSection
        title="Vault profile"
        description={vault.description ?? 'No description'}
        actions={
          <>
            <StatusBadge value={vault.status} />
            <StatusBadge value={vault.scope} />
          </>
        }
      >
        <MetaGrid>
          <Meta label="Vault id" value={vault.id} />
          <Meta label="Metadata" value={stringifyJson(vault.metadata)} />
          <Meta label="Created" value={formatDate(vault.createdAt)} />
          <Meta label="Archived" value={formatDate(vault.archivedAt)} />
        </MetaGrid>
      </DetailSection>
      <DetailSection title="Credential metadata" description="Raw secret values are not returned by the control plane.">
        <TableSurface>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active version</TableHead>
              <TableHead>Secret reference</TableHead>
              <TableHead>Connector binding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.length === 0 ? (
              <TableEmpty colSpan={6}>No credentials are registered in this vault.</TableEmpty>
            ) : (
              credentials.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell className="font-medium">{credential.name}</TableCell>
                  <TableCell>{credential.type}</TableCell>
                  <TableCell>
                    <StatusBadge value={credential.status} />
                  </TableCell>
                  <TableCell>{credential.activeVersionId ?? 'None'}</TableCell>
                  <TableCell>{credential.activeVersion?.referenceName ?? 'Not returned'}</TableCell>
                  <TableCell className="max-w-72 truncate">{stringifyJson(credential.connectorBinding)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </TableSurface>
      </DetailSection>
    </div>
  )
}
