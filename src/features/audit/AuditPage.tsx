import { matchesSearch } from '@/console/format'
import { AuditView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function AuditPage() {
  const context = useConsoleContext()
  const records = context.auditRecords.filter((record) =>
    matchesSearch([record.action, record.resourceType, record.resourceId, record.outcome], context.query),
  )
  return <AuditView records={records} />
}
