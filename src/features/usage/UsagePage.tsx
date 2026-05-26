import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/console/components'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { UsageView } from './UsageView'

export function UsagePage() {
  const usageQuery = useQuery({
    queryKey: queryKeys.usage.summary,
    queryFn: api.readUsageSummary,
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Usage"
        description="Track provider usage, token totals, duration, and cost attribution for the current project."
      />
      <UsageView summary={usageQuery.data ?? null} />
    </div>
  )
}
