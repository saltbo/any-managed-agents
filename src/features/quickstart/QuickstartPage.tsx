import { QuickstartView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function QuickstartPage() {
  const context = useConsoleContext()
  return <QuickstartView agents={context.agents} environments={context.environments} sessions={context.sessions} />
}
