// Create-session provisioning usecases: provider/model resolution, runtime
// capability validation, and the MCP tool snapshot. Deps-first — they read
// through deps.sessionOrchestration and gate MCP tools through deps.policy, so
// they hold no db handle and construct no adapters. Logic is verbatim from the
// former server/runtime/session-provisioning helpers; only how the store/policy
// are acquired changed.

import type { RuntimeName } from '@server/contracts/environment-contracts'
import { runtimeDriver } from '@server/domain/runtime/driver'
import {
  PLATFORM_DEFAULT_PROVIDER,
  providerConfigFromRow,
  type SessionProviderResolution,
} from '@server/domain/runtime/provider'
import {
  type NormalizedEnvironmentSnapshot,
  parseJson,
  type SerializedAgentVersion,
} from '@server/domain/runtime/session-snapshot'
import { runnerSupportsRuntimeProviderModel, runtimeCatalogSupportsProviderModel } from '@server/domain/runtime-catalog'
import type { AuthScope, PolicyPort, SessionOrchestrationStore } from '../ports'

export { providerRuntimeEnv } from '@server/domain/runtime/provider'

type ProvisioningDeps = {
  sessionOrchestration: SessionOrchestrationStore
  policy: PolicyPort
}

// Resolves the agent's provider reference to its configured connection details
// through the orchestration store. A null provider id means "use the project
// default provider"; a project without a configured default falls back to the
// platform Workers AI binding, which needs no configuration row.
export async function resolveSessionProviderConfig(
  deps: Pick<ProvisioningDeps, 'sessionOrchestration'>,
  projectId: string,
  providerId: string | null,
): Promise<SessionProviderResolution> {
  if (providerId === PLATFORM_DEFAULT_PROVIDER) {
    return { ok: true, config: null }
  }
  const store = deps.sessionOrchestration
  if (providerId === null) {
    const row = await store.defaultProviderConfig(projectId)
    if (!row) {
      return { ok: true, config: null }
    }
    return providerConfigFromRow(row)
  }
  const row = await store.namedProviderConfig(projectId, providerId)
  if (!row) {
    return { ok: false, reason: 'not_found' }
  }
  return providerConfigFromRow(row)
}

export async function resolveSessionProviderId(
  deps: Pick<ProvisioningDeps, 'sessionOrchestration'>,
  projectId: string,
  providerId: string | null,
) {
  const store = deps.sessionOrchestration
  if (!providerId) {
    const configuredDefault = await store.configuredDefaultProvider(projectId)
    if (!configuredDefault) {
      return PLATFORM_DEFAULT_PROVIDER
    }
    return configuredDefault.type === PLATFORM_DEFAULT_PROVIDER ? PLATFORM_DEFAULT_PROVIDER : configuredDefault.id
  }
  if (providerId === PLATFORM_DEFAULT_PROVIDER) {
    return PLATFORM_DEFAULT_PROVIDER
  }
  const configured = await store.providerType(projectId, providerId)
  return configured?.type === PLATFORM_DEFAULT_PROVIDER ? PLATFORM_DEFAULT_PROVIDER : providerId
}

export async function validateRuntimeProviderModel(
  deps: Pick<ProvisioningDeps, 'sessionOrchestration'>,
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
    const activeRunnerCapabilities = await deps.sessionOrchestration.activeRunnerCapabilities(
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
  deps: ProvisioningDeps,
  auth: AuthScope,
  sessionId: string,
  agentSnapshot: SerializedAgentVersion,
  environmentSnapshot: NormalizedEnvironmentSnapshot | null,
) {
  const store = deps.sessionOrchestration
  const connectedConnections = await store.connectedConnections(auth.project.id)
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
    const tools = await store.availableConnectionTools(connection.id)
    const allowedTools = []
    for (const tool of tools) {
      const decision = await deps.policy.evaluateMcpTool(auth, {
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
