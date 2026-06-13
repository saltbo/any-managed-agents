import type { AuthScope, PolicyPort } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { AuthContext } from '../../auth/session'
import { evaluateMcpToolPolicy, evaluateProviderPolicy, resolveEffectivePolicy } from '../../policy'

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
    async resolveEffective(auth: AuthScope) {
      const effective = await resolveEffectivePolicy(db, auth as AuthContext)
      return {
        source: effective.source,
        sources: effective.sources,
        accessRules: effective.accessRules,
        toolPolicy: effective.toolPolicy,
        mcpPolicy: effective.mcpPolicy,
        sandboxPolicy: effective.sandboxPolicy,
      }
    },
    async evaluateProvider(auth: AuthScope, values) {
      return await evaluateProviderPolicy(db, auth as AuthContext, values)
    },
  }
}
