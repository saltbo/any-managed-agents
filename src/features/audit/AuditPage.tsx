import { useMemo } from 'react'
import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { useConsoleContext } from '@/features/console/console-context'
import { AuditView } from './AuditView'

export function AuditPage() {
  const context = useConsoleContext()
  const records = useMemo(
    () =>
      context.auditRecords.filter((record) =>
        matchesSearch([record.action, record.resourceType, record.resourceId, record.outcome], context.query),
      ),
    [context.auditRecords, context.query],
  )
  const pagination = useClientPagination(records)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit" description="Review security-relevant control-plane activity and policy decisions." />
      <AuditView records={pagination.items} pagination={pagination} />
    </div>
  )
}
