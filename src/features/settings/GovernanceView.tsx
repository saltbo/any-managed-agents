import { DetailSection, EmptyState, Meta, MetaGrid } from '@/console/components'
import { stringifyJson } from '@/console/format'
import type { GovernancePolicy } from '@/lib/api'

export function GovernanceView({ policy }: { policy: GovernancePolicy | null }) {
  if (!policy)
    return <EmptyState title="No governance policy" body="Project policy will appear after it is configured." />
  return (
    <DetailSection
      title="Governance settings"
      description="Project policy for providers, models, tools, MCP, sandbox, and budgets."
    >
      <MetaGrid>
        <Meta label="Provider rules" value={stringifyJson(policy.providerRules)} />
        <Meta label="Model rules" value={stringifyJson(policy.modelRules)} />
        <Meta label="Tool policy" value={stringifyJson(policy.toolPolicy)} />
        <Meta label="MCP policy" value={stringifyJson(policy.mcpPolicy)} />
        <Meta label="Sandbox policy" value={stringifyJson(policy.sandboxPolicy)} />
        <Meta label="Budget policy" value={stringifyJson(policy.budgetPolicy)} />
      </MetaGrid>
    </DetailSection>
  )
}
