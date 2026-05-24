import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useConsoleContext } from '@/features/console/console-context'
import { AuditView } from './AuditView'

export function AuditPage() {
  const context = useConsoleContext()
  const records = context.auditRecords.filter((record) =>
    matchesSearch([record.action, record.resourceType, record.resourceId, record.outcome], context.query),
  )
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit" description="Review security-relevant control-plane activity and policy decisions." />
      <AuditView records={records} />
    </div>
  )
}
