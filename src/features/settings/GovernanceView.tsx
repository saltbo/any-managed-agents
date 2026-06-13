import { DetailSection, EmptyState, Meta, MetaGrid } from '@/console/components'
import { stringifyJson } from '@/console/format'
import type { EffectivePolicy } from '@/lib/api'

export function GovernanceView({ policy }: { policy: EffectivePolicy | null }) {
  if (!policy)
    return <EmptyState title="No effective policy" body="Effective project governance will appear once it resolves." />
  return (
    <DetailSection
      title="Effective governance"
      description="Read-only merged policy for providers, models, access rules, tools, MCP, sandbox, and budgets."
    >
      <MetaGrid>
        <Meta label="Provider rules" value={stringifyJson(policy.providerRules)} />
        <Meta label="Model rules" value={stringifyJson(policy.modelRules)} />
        <Meta label="Access rules" value={stringifyJson(policy.accessRules)} />
        <Meta label="Tool policy" value={stringifyJson(policy.toolPolicy)} />
        <Meta label="MCP policy" value={stringifyJson(policy.mcpPolicy)} />
        <Meta label="Sandbox policy" value={stringifyJson(policy.sandboxPolicy)} />
        <Meta label="Budgets" value={stringifyJson(policy.budgets)} />
      </MetaGrid>
    </DetailSection>
  )
}
