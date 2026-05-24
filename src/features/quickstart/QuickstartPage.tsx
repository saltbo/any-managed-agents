import { PageHeader } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { QuickstartView } from './QuickstartView'

export function QuickstartPage() {
  const context = useConsoleContext()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Quickstart"
        description="Complete the minimum setup path for creating a session and sending the first runtime message."
      />
      <QuickstartView agents={context.agents} environments={context.environments} sessions={context.sessions} />
    </div>
  )
}
