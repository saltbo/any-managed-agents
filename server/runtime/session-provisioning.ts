import { runnerSupportsRuntimeProviderModel, runtimeCatalogSupportsProviderModel } from '@server/domain/runtime-catalog'
import type { AuthScope } from '@server/usecases/ports'
import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import type { RuntimeName } from '../contracts/environment-contracts'
import { evaluateMcpToolPolicy } from '../policy'
import { runtimeDriver } from './drivers'
import { PLATFORM_DEFAULT_PROVIDER } from './provider-env'
import { type NormalizedEnvironmentSnapshot, parseJson, type SerializedAgentVersion } from './session-snapshot'

// Create-session provisioning: provider/model resolution + runtime capability
// validation + the MCP tool snapshot. Repo/policy-backed reads with no turn
// execution, factored out of the session-orchestration data-plane module.
type Db = Parameters<typeof createRuntimeOrchestrationRepo>[0]

export async function resolveSessionProviderId(db: Db, projectId: string, providerId: string | null) {
  const repo = createRuntimeOrchestrationRepo(db)
  if (!providerId) {
    const configuredDefault = await repo.configuredDefaultProvider(projectId)
    if (!configuredDefault) {
      return PLATFORM_DEFAULT_PROVIDER
    }
    return configuredDefault.type === PLATFORM_DEFAULT_PROVIDER ? PLATFORM_DEFAULT_PROVIDER : configuredDefault.id
  }
  if (providerId === PLATFORM_DEFAULT_PROVIDER) {
    return PLATFORM_DEFAULT_PROVIDER
  }
  const configured = await repo.providerType(projectId, providerId)
  return configured?.type === PLATFORM_DEFAULT_PROVIDER ? PLATFORM_DEFAULT_PROVIDER : providerId
}

export async function validateRuntimeProviderModel(
  db: Db,
  auth: AuthScope,
  environmentId: string,
  hostingMode: 'cloud' | 'self_hosted',
  runtime: RuntimeName,
  provider: string,
  model: string | null,
) {
  const driver = runtimeDriver(runtime)
  if (!driver.supportsHostingMode(hostingMode)) {
    return false
  }
  if (hostingMode === 'self_hosted') {
    if (!runtimeCatalogSupportsProviderModel(hostingMode, runtime, provider, model)) {
      return false
    }
    const activeRunnerCapabilities = await createRuntimeOrchestrationRepo(db).activeRunnerCapabilities(
      auth.project.id,
      environmentId,
    )
    return (
      activeRunnerCapabilities.some((capabilities) =>
        runnerSupportsRuntimeProviderModel(parseJson<string[]>(capabilities) ?? [], runtime, provider, model),
      ) || activeRunnerCapabilities.length === 0
    )
  }
  return driver.supportsCloudProviderModel(provider, model)
}

export function mcpConnectorIds(snapshot: Record<string, unknown>) {
  const connectors = Array.isArray(snapshot.connectors) ? (snapshot.connectors as unknown[]) : []
  return connectors
    .map((connector) =>
      connector && typeof connector === 'object' && 'connectorId' in connector
        ? (connector.connectorId as unknown)
        : null,
    )
    .filter((connectorId): connectorId is string => typeof connectorId === 'string')
}

export async function resolveMcpSnapshot(
  db: Db,
  auth: AuthScope,
  sessionId: string,
  agentSnapshot: SerializedAgentVersion,
  environmentSnapshot: NormalizedEnvironmentSnapshot | null,
) {
  const repo = createRuntimeOrchestrationRepo(db)
  const connectedConnections = await repo.connectedConnections(auth.project.id)
  const agentConnectors = agentSnapshot.mcpConnectors
  const scopedConnections =
    agentConnectors.length === 0
      ? connectedConnections
      : connectedConnections.filter((connection) => agentConnectors.includes(connection.connectorId))

  const snapshotConnections = []
  const sessionContext = {
    id: sessionId,
    agentSnapshot: JSON.stringify(agentSnapshot),
    environmentSnapshot: environmentSnapshot ? JSON.stringify(environmentSnapshot) : null,
  }
  for (const connection of scopedConnections) {
    const tools = await repo.availableConnectionTools(connection.id)
    const allowedTools = []
    for (const tool of tools) {
      const decision = await evaluateMcpToolPolicy(db, auth, {
        connectorId: connection.connectorId,
        toolName: tool.name,
        session: sessionContext,
      })
      if (decision.allowed) {
        allowedTools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: parseJson<Record<string, unknown>>(tool.inputSchema) ?? {},
          approvalMode: tool.approvalMode,
          policyMetadata: parseJson<Record<string, unknown>>(tool.policyMetadata) ?? {},
        })
      }
    }
    if (allowedTools.length > 0) {
      snapshotConnections.push({
        connectionId: connection.id,
        connectorId: connection.connectorId,
        endpointUrl: connection.endpointUrl,
        approvalMode: connection.approvalMode,
        credentialRef: connection.credentialVersionId ?? connection.credentialId,
        tools: allowedTools,
      })
    }
  }
  return { connectors: snapshotConnections }
}
