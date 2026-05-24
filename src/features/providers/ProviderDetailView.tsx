import { DetailSection, EmptyState, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { stringifyJson } from '@/console/format'
import type { Provider } from '@/lib/api'

export function ProviderDetailView({ provider }: { provider: Provider | null }) {
  if (!provider) return <EmptyState title="Provider not found" body="The requested provider is not in this project." />
  return (
    <DetailSection
      title="Provider profile"
      description={provider.type}
      actions={
        <>
          <StatusBadge value={provider.status} />
          <StatusBadge value={provider.credentialStatus} />
        </>
      }
    >
      <MetaGrid>
        <Meta label="Provider id" value={provider.id} />
        <Meta label="Base URL" value={provider.baseUrl ?? 'Platform default'} />
        <Meta label="Rate limits" value={stringifyJson(provider.rateLimits)} />
        <Meta label="Budget policy" value={stringifyJson(provider.budgetPolicy)} />
        <Meta label="Metadata" value={stringifyJson(provider.metadata)} />
        <Meta label="Last error" value={provider.lastError ? stringifyJson(provider.lastError) : 'None'} />
      </MetaGrid>
    </DetailSection>
  )
}
