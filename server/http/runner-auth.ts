import type { AuthContext } from '@server/auth/session'
import { isRunnerOidcAuth } from '@server/auth/session'
import type { RunnerOidcContext } from '@server/domain/runner-queue'
import type { Env } from '@server/env'
import { errorResponse } from '@server/errors'
import type { RunnerAuthRecord } from '@server/usecases/ports'
import type { Context } from 'hono'

// Runner-token authorization is auth-context based, so it lives in the http
// layer alongside requireAuth. A console (non-runner) identity may operate any
// runner in its project; a runner OIDC/federated token may only operate the
// runner row its claims are bound to.
export function runnerOperationAuthorized(env: Env, auth: AuthContext, runner: RunnerAuthRecord): boolean {
  if (isRunnerOidcAuth(env, auth)) {
    if (runner.authMode === 'federated') {
      return runner.oidcSubject === auth.oidc.subject
    }
    return (
      runner.authMode === 'oidc' &&
      runner.oidcSubject === auth.oidc.subject &&
      !!runner.oidcClientId &&
      runner.oidcClientId === auth.oidc.clientId
    )
  }
  if (runner.authMode !== 'oidc') {
    return true
  }
  if (!runner.oidcSubject || !runner.oidcClientId) {
    return false
  }
  return runner.oidcSubject === auth.oidc.subject && runner.oidcClientId === auth.oidc.clientId
}

export function runnerForbidden(c: Context) {
  return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this runner')
}

// Projects the request auth context's OIDC claims into the binding descriptor
// the runner-registration usecase reasons over.
export function runnerOidcContext(env: Env, auth: AuthContext): RunnerOidcContext {
  return {
    isRunnerToken: isRunnerOidcAuth(env, auth),
    subject: auth.oidc.subject,
    clientId: auth.oidc.clientId,
    runnerProjectId: auth.oidc.runnerProjectId,
    runnerEnvironmentId: auth.oidc.runnerEnvironmentId,
    externalTenantId: auth.oidc.externalTenantId,
  }
}
