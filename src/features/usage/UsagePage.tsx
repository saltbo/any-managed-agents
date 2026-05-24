import { PageHeader } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { UsageView } from './UsageView'

export function UsagePage() {
  const context = useConsoleContext()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Usage"
        description="Track provider usage, token totals, duration, and cost attribution for the current project."
      />
      <UsageView summary={context.usageSummary} />
    </div>
  )
}
