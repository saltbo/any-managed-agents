import { SessionsView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function SessionsPage() {
  const context = useConsoleContext()
  return (
    <SessionsView
      sessions={context.sessions}
      selectedSession={context.selectedSession}
      events={context.sessionEvents}
      runtimeTranscript={context.runtimeTranscript}
      onSelect={context.setSelectedSessionId}
      onStop={context.stopSession}
      onArchive={context.archiveSession}
      onRefreshEvents={context.refreshEvents}
      taskMessage={context.taskMessage}
      setTaskMessage={context.setTaskMessage}
      onSendTask={(event) => {
        event.preventDefault()
        context.sendTask()
      }}
    />
  )
}
