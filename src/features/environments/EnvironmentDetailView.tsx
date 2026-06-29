import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmAction, DetailSection, EmptyState, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { archivedLabel, isArchived } from '@/console/format'
import { RelatedResourcesTable } from '@/features/console/related-resources-table'
import type { Environment, Session } from '@/lib/amarpc'

function networkSummary(environment: Environment) {
  if (environment.spec.networking.type === 'limited') {
    return `Limited: ${(environment.spec.networking.allowedHosts ?? []).join(', ')}`
  }
  return environment.spec.networking.type
}

function packageSummary(environment: Environment) {
  return Object.entries(environment.spec.packages)
    .filter(([key]) => key !== 'type')
    .flatMap(([manager, packages]) => (packages as string[]).map((pkg) => `${manager}:${pkg}`))
    .join(', ')
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
          <Meta label="Packages" value={packageSummary(environment) || 'None'} />
          <Meta label="Variables" value={Object.keys(environment.spec.variables).join(', ') || 'None'} />
          <Meta label="Type" value={environment.spec.type} />
          <Meta label="Networking" value={networkSummary(environment)} />
          <Meta label="MCP servers" value={environment.spec.networking.allowMcpServers ? 'Allowed' : 'Blocked'} />
          <Meta
            label="Package managers"
            value={environment.spec.networking.allowPackageManagers ? 'Allowed' : 'Blocked'}
          />
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
