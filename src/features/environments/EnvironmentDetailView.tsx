import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmAction, DetailSection, EmptyState, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { archivedLabel, isArchived, stringifyJson } from '@/console/format'
import { RelatedResourcesTable } from '@/features/console/related-resources-table'
import type { Environment, Session } from '@/lib/api'

function networkSummary(environment: Environment) {
  if (environment.networkPolicy.mode === 'restricted') {
    return `Restricted: ${environment.networkPolicy.allowedHosts.join(', ')}`
  }
  return environment.networkPolicy.mode
}

function runtimeConfigSummary(environment: Environment) {
  return String(environment.runtimeConfig.image ?? environment.runtimeConfig.mode ?? 'Default')
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
  const boundSessions = sessions.filter((session) => session.spec.environmentId === environment.id)
  return (
    <div className="grid gap-4">
      <DetailSection
        title="Environment profile"
        description={environment.description ?? 'No description'}
        actions={
          <>
            <StatusBadge value={archivedLabel(environment)} />
            <StatusBadge value={`v${environment.version}`} />
            {!isArchived(environment) ? (
              <ConfirmAction
                title="Archive environment?"
                description={`Archive ${environment.name}. New sessions cannot use this environment.`}
                confirmLabel="Archive environment"
                destructive
                onConfirm={() => onArchive(environment.id)}
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
          <Meta label="Packages" value={environment.packages.map((item) => item.name).join(', ') || 'None'} />
          <Meta label="Variables" value={Object.keys(environment.variables).join(', ') || 'None'} />
          <Meta label="Hosting mode" value={environment.hostingMode} />
          <Meta label="Runtime config" value={runtimeConfigSummary(environment)} />
          <Meta label="Network policy" value={networkSummary(environment)} />
          <Meta label="MCP policy" value={stringifyJson(environment.mcpPolicy)} />
          <Meta label="Package manager policy" value={stringifyJson(environment.packageManagerPolicy)} />
          <Meta label="Resource limits" value={stringifyJson(environment.resourceLimits)} />
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
