import { RefreshCw, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ConfirmAction,
  DetailSection,
  EmptyState,
  Meta,
  MetaGrid,
  StatusBadge,
  TableSurface,
} from '@/console/components'
import { archivedLabel, formatDate, isArchived, stringifyJson } from '@/console/format'
import type { AuditRecord, Vault, VaultCredential } from '@/lib/api'

export function VaultDetailView({
  vault,
  credentials,
  auditRecords,
  loading,
  onAddCredential,
  onRotate,
  onRevoke,
}: {
  vault: Vault | null
  credentials: VaultCredential[]
  auditRecords: AuditRecord[]
  loading: boolean
  onAddCredential: () => void
  onRotate: (credential: VaultCredential) => void
  onRevoke: (credential: VaultCredential) => void
}) {
  if (loading) {
    return (
      <output aria-label="Loading vault detail" className="grid gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </output>
    )
  }
  if (!vault) return <EmptyState title="Vault not found" body="The requested vault is not in this project." />
  const vaultActive = !isArchived(vault)
  return (
    <div className="grid gap-4">
      <DetailSection
        title="Vault profile"
        description={vault.description ?? 'No description'}
        actions={
          <>
            <StatusBadge value={archivedLabel(vault)} />
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
      <DetailSection
        title="Credential metadata"
        description="Raw secret values are not returned by the control plane."
        actions={
          vaultActive ? (
            <Button type="button" onClick={onAddCredential}>
              Add credential
            </Button>
          ) : null
        }
      >
        {credentials.length === 0 ? (
          <EmptyState
            title="No credentials"
            body={
              vaultActive
                ? 'Store a credential to track safe versioned secret references for runtime use.'
                : 'This vault is archived. Credential metadata stays readable for audit, but no credentials exist.'
            }
            action={
              vaultActive ? (
                <Button type="button" onClick={onAddCredential}>
                  Add credential
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableSurface>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Secret reference</TableHead>
                <TableHead>Connector binding</TableHead>
                {vaultActive ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell className="font-medium">{credential.name}</TableCell>
                  <TableCell>{credential.type}</TableCell>
                  <TableCell>
                    <StatusBadge value={credential.state} />
                  </TableCell>
                  <TableCell>{credential.activeVersion ? `v${credential.activeVersion.version}` : 'None'}</TableCell>
                  <TableCell className="max-w-64 truncate">
                    {credential.activeVersion?.referenceName ?? 'Not returned'}
                  </TableCell>
                  <TableCell className="max-w-72 truncate">{stringifyJson(credential.connectorBinding)}</TableCell>
                  {vaultActive ? (
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {credential.state === 'active' ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label="Rotate credential"
                              onClick={() => onRotate(credential)}
                            >
                              <RefreshCw data-icon="inline-start" />
                            </Button>
                            <ConfirmAction
                              title="Revoke credential?"
                              description={`Revoke ${credential.name}. Future runtime resolution is blocked; version references stay auditable.`}
                              confirmLabel="Revoke credential"
                              destructive
                              onConfirm={() => onRevoke(credential)}
                            >
                              <Button type="button" variant="outline" size="icon" aria-label="Revoke credential">
                                <ShieldOff data-icon="inline-start" />
                              </Button>
                            </ConfirmAction>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </TableSurface>
        )}
      </DetailSection>
      <DetailSection title="Audit history" description="Vault and credential lifecycle activity for this vault.">
        {auditRecords.length === 0 ? (
          <EmptyState title="No audit history" body="Vault and credential changes will appear here." />
        ) : (
          <TableSurface>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditRecords.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{record.action}</TableCell>
                  <TableCell className="max-w-64 truncate">{record.resourceId ?? record.resourceType}</TableCell>
                  <TableCell>
                    <StatusBadge value={record.outcome} />
                  </TableCell>
                  <TableCell>{formatDate(record.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableSurface>
        )}
      </DetailSection>
    </div>
  )
}
