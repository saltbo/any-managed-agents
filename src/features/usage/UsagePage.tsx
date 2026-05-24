import { UsageView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function UsagePage() {
  const context = useConsoleContext()
  return <UsageView summary={context.usageSummary} />
}
