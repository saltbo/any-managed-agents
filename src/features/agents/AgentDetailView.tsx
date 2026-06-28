import { Archive } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmAction, DetailSection, EmptyState, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { archivedLabel, formatDate, isArchived, stringifyJson } from '@/console/format'
import { JsonBlock } from '@/features/console/json-block'
import { RelatedResourcesTable } from '@/features/console/related-resources-table'
import type { Agent, AgentVersion, Session } from '@/lib/api'

export function AgentDetailView({
  agent,
  versions,
  sessions,
  onArchive,
}: {
  agent: Agent | null
  versions: AgentVersion[]
  sessions: Session[]
  onArchive?: (id: string) => void
}) {
  if (!agent) return <EmptyState title="Agent not found" body="The requested agent is not in the current project." />
  return (
    <AgentDetailContent
      agent={agent}
      versions={versions}
      sessions={sessions}
      {...(onArchive !== undefined ? { onArchive } : {})}
    />
  )
}

function AgentDetailContent({
  agent,
  versions,
  sessions,
  onArchive,
}: {
  agent: Agent
  versions: AgentVersion[]
  sessions: Session[]
  onArchive?: (id: string) => void
}) {
  const [selectedVersionId, setSelectedVersionId] = useState('')

  useEffect(() => {
    setSelectedVersionId((current) => current || versions[0]?.id || '')
  }, [versions])

  const agentSessions = sessions.filter((session) => session.spec.agentId === agent.id)
  const currentVersion = useMemo(
    () =>
      versions.find((version) => version.id === selectedVersionId) ??
      versions[0] ?? {
        id: agent.currentVersionId ?? agent.id,
        agentId: agent.id,
        projectId: agent.projectId,
        version: agent.version,
        instructions: agent.instructions,
        providerId: agent.providerId,
        model: agent.model,
        skills: agent.skills,
        subagents: agent.subagents,
        role: agent.role,
        capabilityTags: agent.capabilityTags,
        handoffPolicy: agent.handoffPolicy,
        memoryPolicy: agent.memoryPolicy,
        tools: agent.tools,
        mcpConnectors: agent.mcpConnectors,
        metadata: agent.metadata,
        createdAt: agent.updatedAt,
      },
    [agent, selectedVersionId, versions],
  )
  return (
    <div>
      <Tabs defaultValue="agent">
        <TabsList>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>
        <TabsContent value="agent" className="mt-4">
          <DetailSection
            title="Agent model configuration"
            description="Immutable provider, model, and tool settings captured by the selected agent version."
            actions={
              <>
                <StatusBadge value={archivedLabel(agent)} />
                {versions.length > 0 ? (
                  <Select value={currentVersion.id} onValueChange={setSelectedVersionId}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {versions.map((version) => (
                          <SelectItem key={version.id} value={version.id}>
                            v{version.version}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : null}
                {onArchive && !isArchived(agent) ? (
                  <ConfirmAction
                    title="Archive agent?"
                    description={`Archive ${agent.name}. Existing sessions are not deleted, but this agent will no longer accept new sessions.`}
                    confirmLabel="Archive agent"
                    destructive
                    onConfirm={() => onArchive(agent.id)}
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
            <div className="grid gap-4">
              <MetaGrid>
                <Meta label="Version" value={`v${currentVersion.version}`} />
                <Meta label="Created" value={formatDate(currentVersion.createdAt)} />
                <Meta label="Provider" value={currentVersion.providerId ?? 'None'} />
                <Meta label="Model" value={currentVersion.model ?? 'None'} />
                <Meta label="Skills" value={currentVersion.skills.join(', ') || 'None'} />
                <Meta
                  label="Allowed tools"
                  value={currentVersion.tools.map((tool) => tool.name).join(', ') || 'None'}
                />
                <Meta label="MCP connectors" value={currentVersion.mcpConnectors.join(', ') || 'None'} />
                <Meta label="Role" value={currentVersion.role ?? 'None'} />
                <Meta label="Capability tags" value={currentVersion.capabilityTags.join(', ') || 'None'} />
                <Meta label="Handoff policy" value={stringifyJson(currentVersion.handoffPolicy)} />
                <Meta label="Memory policy" value={stringifyJson(currentVersion.memoryPolicy)} />
                <Meta label="Metadata" value={stringifyJson(currentVersion.metadata)} />
              </MetaGrid>
              <JsonBlock
                value={stringifyJson({
                  instructions: currentVersion.instructions,
                  providerId: currentVersion.providerId,
                  model: currentVersion.model,
                })}
              />
            </div>
          </DetailSection>
        </TabsContent>
        <TabsContent value="sessions" className="mt-4">
          <RelatedResourcesTable title="Sessions" empty="No sessions have used this agent yet." items={agentSessions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
