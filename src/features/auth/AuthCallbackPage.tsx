import { useEffect, useState } from 'react'
import { FullscreenMessage } from '@/console/components'
import { completeSignIn } from '@/lib/oidc'

export function AuthCallbackPage() {
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    completeSignIn()
      .then((returnTo) => window.location.replace(returnTo))
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error('OIDC sign-in failed')))
  }, [])

  if (error) {
    return <FullscreenMessage title="Sign-in failed" body={error.message} />
  }

  return <FullscreenMessage title="Completing sign-in" body="Returning from FlareAuth." />
}
