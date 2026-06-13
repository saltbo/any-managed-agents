import { useQuery } from '@tanstack/react-query'
import { ShieldPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, PageHeader, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { formatDate } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { CreateAccessRuleSheet } from './CreateAccessRuleSheet'

export function ProviderPolicyPage() {
  const [creating, setCreating] = useState(false)
  const rulesQuery = useQuery({
    queryKey: queryKeys.governance.accessRules,
    queryFn: () => api.listAccessRules(),
  })
  const rules = rulesQuery.data?.data ?? []
  const pagination = useClientPagination(rules)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Providers"
        title="Provider access policy"
        description="Project rules that allow or deny providers and models, optionally scoped to OIDC teams."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <ShieldPlus data-icon="inline-start" />
            Add access rule
          </Button>
        }
      />
      {rulesQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rules.length === 0 ? (
        <EmptyState
          title="No access rules"
          body="Every configured provider is currently usable. Add a rule to deny a provider or restrict it to teams."
        />
      ) : (
        <TableSurface viewportRef={pagination.viewportRef} footer={<TablePagination pagination={pagination} />}>
          <TableHeader>
            <TableRow>
              <TableHead>Effect</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.items.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>
                  <StatusBadge value={rule.effect} />
                </TableCell>
                <TableCell className="max-w-48 break-all">{rule.providerId}</TableCell>
                <TableCell className="max-w-48 break-all">{rule.modelId}</TableCell>
                <TableCell className="max-w-40 break-all">{rule.teamId ?? 'All teams'}</TableCell>
                <TableCell className="max-w-64 truncate">{rule.reason ?? '—'}</TableCell>
                <TableCell>{formatDate(rule.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableSurface>
      )}
      <CreateAccessRuleSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
