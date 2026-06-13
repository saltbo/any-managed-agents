import type { AuthScope, PolicyPort } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { AuthContext } from '../../auth/session'
import { evaluateMcpToolPolicy, resolveEffectivePolicy } from '../../policy'

type Db = ReturnType<typeof drizzle>

export function createPolicyPort(db: Db): PolicyPort {
  return {
    async resolveToolPolicy(auth: AuthScope) {
      const effective = await resolveEffectivePolicy(db, auth as AuthContext)
      return effective.toolPolicy
    },
    async resolveMcpPolicy(auth: AuthScope) {
      const effective = await resolveEffectivePolicy(db, auth as AuthContext)
      return effective.mcpPolicy
    },
    async evaluateMcpTool(auth: AuthScope, values) {
      return await evaluateMcpToolPolicy(db, auth as AuthContext, values)
    },
  }
}
