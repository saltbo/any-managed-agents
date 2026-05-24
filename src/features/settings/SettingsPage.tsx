import { PageHeader } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { GovernanceView } from './GovernanceView'

export function SettingsPage() {
  const context = useConsoleContext()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Review effective project governance for providers, tools, MCP, sandbox, and budgets."
      />
      <GovernanceView policy={context.governancePolicy} />
    </div>
  )
}
