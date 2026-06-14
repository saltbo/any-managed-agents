import type { AuthScope, PolicyPort } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import {
  evaluateMcpToolPolicy,
  evaluateProviderPolicy,
  evaluateProviderPolicyForSession,
  evaluateSandboxRuntimePolicy,
  policyBlocksSandboxOperation,
  resolveEffectivePolicy,
  toolPolicyRequiresApproval,
} from '../../policy'

type Db = ReturnType<typeof drizzle>

export function createPolicyPort(db: Db): PolicyPort {
  return {
    async resolveToolPolicy(auth: AuthScope) {
      const effective = await resolveEffectivePolicy(db, auth)
      return effective.toolPolicy
    },
    async resolveMcpPolicy(auth: AuthScope) {
      const effective = await resolveEffectivePolicy(db, auth)
      return effective.mcpPolicy
    },
    async evaluateMcpTool(auth: AuthScope, values) {
      return await evaluateMcpToolPolicy(db, auth, values)
    },
    async resolveEffective(auth: AuthScope) {
      const effective = await resolveEffectivePolicy(db, auth)
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
      return await evaluateProviderPolicy(db, auth, values)
    },
    async evaluateSandboxRuntime(auth: AuthScope, values) {
      return await evaluateSandboxRuntimePolicy(db, auth, values)
    },
    async policyBlocksSandboxOperation(auth: AuthScope, values) {
      return await policyBlocksSandboxOperation(db, auth, values)
    },
    async toolPolicyRequiresApproval(auth: AuthScope, toolName: string) {
      return await toolPolicyRequiresApproval(db, auth, toolName)
    },
    async evaluateProviderForSession(auth: AuthScope, values) {
      return await evaluateProviderPolicyForSession(db, auth, values)
    },
  }
}
