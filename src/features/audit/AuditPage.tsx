import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { useUrlFilter } from '@/console/use-list-filters'
import { type AuditRecordListOptions, api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { AuditView } from './AuditView'

const OUTCOMES = ['success', 'failure', 'denied']

export function AuditPage() {
  const [action, setAction] = useUrlFilter('action')
  const [resourceType, setResourceType] = useUrlFilter('resourceType')
  const [outcome, setOutcome] = useUrlFilter('outcome', 'all')
  const [actorId, setActorId] = useUrlFilter('actorId')
  const [createdFrom, setCreatedFrom] = useUrlFilter('createdFrom')
  const [createdTo, setCreatedTo] = useUrlFilter('createdTo')
  const [projectId] = useUrlFilter('projectId')
  const [exporting, setExporting] = useState(false)
  const filters = useMemo<AuditRecordListOptions>(
    () => ({
      ...(action ? { action } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(outcome !== 'all' ? { outcome } : {}),
      ...(actorId ? { actorId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(createdFrom ? { createdFrom: new Date(createdFrom).toISOString() } : {}),
      ...(createdTo ? { createdTo: new Date(createdTo).toISOString() } : {}),
    }),
    [action, resourceType, outcome, actorId, projectId, createdFrom, createdTo],
  )
  const auditQuery = useQuery({
    queryKey: queryKeys.audit.records(filters),
    queryFn: () => api.listAuditRecords(filters),
  })
  const records = auditQuery.data?.data ?? []
  const pagination = useClientPagination(records)
  const exportRecords = async () => {
    setExporting(true)
    try {
      const exported = await api.exportAuditRecords(filters)
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `audit-records-${new Date().toISOString()}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${exported.length} audit record${exported.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit"
        description="Review security-relevant control-plane activity and policy decisions."
        actions={
          <Button type="button" variant="outline" onClick={exportRecords} disabled={exporting}>
            <Download data-icon="inline-start" />
            Export records
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Filter by action"
          aria-label="Filter by action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className="w-full sm:w-48"
        />
        <Input
          type="search"
          placeholder="Filter by resource type"
          aria-label="Filter by resource type"
          value={resourceType}
          onChange={(event) => setResourceType(event.target.value)}
          className="w-full sm:w-48"
        />
        <Input
          type="search"
          placeholder="Filter by actor"
          aria-label="Filter by actor"
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
          className="w-full sm:w-48"
        />
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            {OUTCOMES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="datetime-local"
          aria-label="Audit from"
          value={createdFrom}
          onChange={(event) => setCreatedFrom(event.target.value)}
          className="w-full sm:w-56"
        />
        <Input
          type="datetime-local"
          aria-label="Audit to"
          value={createdTo}
          onChange={(event) => setCreatedTo(event.target.value)}
          className="w-full sm:w-56"
        />
      </div>
      <AuditView records={pagination.items} pagination={pagination} />
    </div>
  )
}
