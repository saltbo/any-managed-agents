import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { FullscreenMessage } from '@/console/components'
import { ApiError } from '@/lib/api'
import { ConsoleShell } from './ConsoleShell'
import { CreateResourceSheet } from './CreateResourceSheet'
import { ConsoleContextProvider } from './console-context'
import { useConsoleController } from './use-console-controller'

export function ConsoleLayout() {
  const { authQuery, contextValue, createSheetProps } = useConsoleController()

  if (authQuery.isLoading) {
    return <FullscreenMessage title="Loading console" body="Checking session and project context." />
  }

  if (authQuery.error instanceof ApiError && authQuery.error.status === 401) {
    const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
    return (
      <FullscreenMessage
        title="Any Managed Agents"
        body="Sign in through FlareAuth to open the control plane."
        action={
          <Button asChild size="lg">
            <a href={`/api/auth/login?returnTo=${returnTo}`}>Continue with FlareAuth</a>
          </Button>
        }
      />
    )
  }

  if (!contextValue) {
    return <FullscreenMessage title="Console unavailable" body="Unable to load the current project context." />
  }

  return (
    <ConsoleContextProvider value={contextValue}>
      <ConsoleShell>
        <Outlet />
      </ConsoleShell>
      <CreateResourceSheet {...createSheetProps} />
    </ConsoleContextProvider>
  )
}
