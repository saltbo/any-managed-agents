import { useQuery } from '@tanstack/react-query'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { FullscreenMessage } from '@/console/components'
import { ApiError, api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { ConsoleShell } from './ConsoleShell'
import { ConsoleContextProvider } from './console-context'

export function ConsoleLayout() {
  const authQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: api.me,
    retry: false,
  })

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

  if (!authQuery.data) {
    return <FullscreenMessage title="Console unavailable" body="Unable to load the current project context." />
  }

  return (
    <ConsoleContextProvider value={{ auth: authQuery.data }}>
      <ConsoleShell>
        <Outlet />
      </ConsoleShell>
    </ConsoleContextProvider>
  )
}
