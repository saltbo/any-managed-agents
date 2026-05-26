import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { AuditView } from './AuditView'

export function AuditPage() {
  const auditQuery = useQuery({
    queryKey: queryKeys.audit.records,
    queryFn: api.listAuditRecords,
  })
  const records = auditQuery.data?.data ?? []
  const pagination = useClientPagination(records)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit" description="Review security-relevant control-plane activity and policy decisions." />
      <AuditView records={pagination.items} pagination={pagination} />
    </div>
  )
}
