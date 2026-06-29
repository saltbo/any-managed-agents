import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmAction, DetailSection, EmptyState, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { archivedLabel, isArchived, stringifyJson } from '@/console/format'
import { RelatedResourcesTable } from '@/features/console/related-resources-table'
import type { Environment, Session } from '@/lib/api'

function networkSummary(environment: Environment) {
  if (environment.spec.networkPolicy.mode === 'restricted') {
    return `Restricted: ${environment.spec.networkPolicy.allowedHosts.join(', ')}`
  }
  return environment.spec.networkPolicy.mode
}

function runtimeConfigSummary(environment: Environment) {
  return String(environment.spec.runtimeConfig.image ?? environment.spec.runtimeConfig.mode ?? 'Default')
}

export function EnvironmentDetailView({
  environment,
  sessions,
  onArchive,
}: {
  environment: Environment | null
  sessions: Session[]
  onArchive: (id: string) => void
}) {
  if (!environment) {
    return <EmptyState title="Environment not found" body="The requested environment is not in the current project." />
  }
  const boundSessions = sessions.filter((session) => session.spec.environmentId === environment.metadata.uid)
  return (
    <div className="grid gap-4">
      <DetailSection
        title="Environment profile"
        description={environment.metadata.description ?? 'No description'}
        actions={
          <>
            <StatusBadge value={archivedLabel(environment)} />
            <StatusBadge value={`v${environment.status.version}`} />
            {!isArchived(environment) ? (
              <ConfirmAction
                title="Archive environment?"
                description={`Archive ${environment.metadata.name}. New sessions cannot use this environment.`}
                confirmLabel="Archive environment"
                destructive
                onConfirm={() => onArchive(environment.metadata.uid)}
              >
                <Button type="button" variant="outline">
                  <Archive data-icon="inline-start" />
                  Archive
                </Button>
              </ConfirmAction>
            ) : null}
          </>
        }
      >
        <MetaGrid>
          <Meta label="Packages" value={environment.spec.packages.map((item) => item.name).join(', ') || 'None'} />
          <Meta label="Variables" value={Object.keys(environment.spec.variables).join(', ') || 'None'} />
          <Meta label="Hosting mode" value={environment.spec.hostingMode} />
          <Meta label="Runtime config" value={runtimeConfigSummary(environment)} />
          <Meta label="Network policy" value={networkSummary(environment)} />
          <Meta label="MCP policy" value={stringifyJson(environment.spec.mcpPolicy)} />
          <Meta label="Package manager policy" value={stringifyJson(environment.spec.packageManagerPolicy)} />
          <Meta label="Resource limits" value={stringifyJson(environment.spec.resourceLimits)} />
        </MetaGrid>
      </DetailSection>
      <RelatedResourcesTable
        title="Sessions using this environment"
        empty="No sessions use this environment."
        items={boundSessions}
      />
    </div>
  )
}
