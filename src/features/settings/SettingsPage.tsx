import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/console/components'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { GovernanceView } from './GovernanceView'

export function SettingsPage() {
  const policyQuery = useQuery({
    queryKey: queryKeys.governance.effectivePolicy,
    queryFn: () => api.readEffectivePolicy(),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Review effective project governance for providers, tools, MCP, sandbox, and budgets."
      />
      <GovernanceView policy={policyQuery.data ?? null} />
    </div>
  )
}
