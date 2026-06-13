import type { AuthScope, PolicyPort } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { AuthContext } from '../../auth/session'
import { resolveEffectivePolicy } from '../../policy'

type Db = ReturnType<typeof drizzle>

export function createPolicyPort(db: Db): PolicyPort {
  return {
    async resolveToolPolicy(auth: AuthScope) {
      const effective = await resolveEffectivePolicy(db, auth as AuthContext)
      return effective.toolPolicy
    },
  }
}
