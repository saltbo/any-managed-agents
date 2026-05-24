import { useEffect, useMemo, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DetailSection, EmptyState, Meta, MetaGrid } from '@/console/components'
import { formatDate, stringifyJson } from '@/console/format'
import { JsonBlock } from '@/features/console/json-block'
import { RelatedResourcesTable } from '@/features/console/related-resources-table'
import type { Agent, AgentVersion, Session } from '@/lib/api'

export function AgentDetailView({
  agent,
  versions,
  sessions,
}: {
  agent: Agent | null
  versions: AgentVersion[]
  sessions: Session[]
}) {
  if (!agent) return <EmptyState title="Agent not found" body="The requested agent is not in the current project." />
  return <AgentDetailContent agent={agent} versions={versions} sessions={sessions} />
}

function AgentDetailContent({
  agent,
  versions,
  sessions,
}: {
  agent: Agent
  versions: AgentVersion[]
  sessions: Session[]
}) {
  const [selectedVersionId, setSelectedVersionId] = useState('')

  useEffect(() => {
    setSelectedVersionId((current) => current || versions[0]?.id || '')
  }, [versions])

  const agentSessions = sessions.filter((session) => session.agentId === agent.id)
  const currentVersion = useMemo(
    () =>
      versions.find((version) => version.id === selectedVersionId) ??
      versions[0] ?? {
        id: agent.currentVersionId ?? agent.id,
        agentId: agent.id,
        projectId: agent.projectId,
        version: agent.version,
        instructions: agent.instructions,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        allowedTools: agent.allowedTools,
        mcpConnectors: agent.mcpConnectors,
        sandboxPolicy: agent.sandboxPolicy,
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
            title="Runtime configuration"
            description="Immutable settings captured by the selected agent version."
            actions={
              versions.length > 0 ? (
                <Select value={currentVersion.id} onValueChange={setSelectedVersionId}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        v{version.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null
            }
          >
            <div className="grid gap-4">
              <MetaGrid>
                <Meta label="Version" value={`v${currentVersion.version}`} />
                <Meta label="Created" value={formatDate(currentVersion.createdAt)} />
                <Meta label="Model" value={`${currentVersion.provider} / ${currentVersion.model}`} />
                <Meta label="Allowed tools" value={currentVersion.allowedTools.join(', ') || 'None'} />
                <Meta label="MCP connectors" value={currentVersion.mcpConnectors.join(', ') || 'None'} />
                <Meta label="Sandbox policy" value={stringifyJson(currentVersion.sandboxPolicy)} />
                <Meta label="Metadata" value={stringifyJson(currentVersion.metadata)} />
              </MetaGrid>
              <JsonBlock
                value={stringifyJson({
                  instructions: currentVersion.instructions,
                  systemPrompt: currentVersion.systemPrompt,
                  provider: currentVersion.provider,
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
