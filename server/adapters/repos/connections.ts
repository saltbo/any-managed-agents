import type {
  ConnectionApprovalMode,
  ConnectionState,
  ToolAvailability,
  ToolCallState,
} from '@server/domain/connection'
import type { ConnectorCatalogTool } from '@server/domain/connector'
import type {
  ConnectionListQuery,
  ConnectionRecord,
  ConnectionRepo,
  ConnectionToolRecord,
  CreateConnectionInput,
  ListPageResult,
  McpServerToolDescriptor,
  ResolvedCredential,
  ToolCallExecution,
  ToolCallListQuery,
  ToolCallRecord,
  UpdateConnectionFields,
  VaultVisibility,
} from '@server/usecases/ports'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import {
  connections,
  connectionTools,
  sessions,
  toolCalls,
  vaultCredentials,
  vaultCredentialVersions,
} from '../../db/schema'
import { redactSensitiveValue } from '../../redaction'

type Db = ReturnType<typeof drizzle>
type ConnectionRow = typeof connections.$inferSelect
type ToolRow = typeof connectionTools.$inferSelect
type ToolCallRow = typeof toolCalls.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null | undefined, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function connectionRecordFrom(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    connectorId: row.connectorId,
    credentialId: row.credentialId,
    credentialVersionId: row.credentialVersionId,
    endpointUrl: row.endpointUrl,
    approvalMode: row.approvalMode as ConnectionApprovalMode,
    state: row.state as ConnectionState,
    lastError: parseJson<Record<string, unknown> | null>(row.lastError, null),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toolRecordFrom(row: ToolRow): ConnectionToolRecord {
  return {
    id: row.id,
    connectionId: row.connectionId,
    connectorId: row.connectorId,
    name: row.name,
    description: row.description,
    inputSchema: parseJson<Record<string, unknown>>(row.inputSchema, {}),
    approvalMode: row.approvalMode as ConnectionApprovalMode,
    policyMetadata: parseJson<Record<string, unknown>>(row.policyMetadata, {}),
    availability: row.availability as ToolAvailability,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toolCallRecordFrom(row: ToolCallRow): ToolCallRecord {
  return {
    id: row.id,
    connectionId: row.connectionId,
    connectorId: row.connectorId,
    toolName: row.toolName,
    sessionId: row.sessionId ?? '',
    state: row.state as ToolCallState,
    input: parseJson<Record<string, unknown>>(row.input, {}),
    output: parseJson<Record<string, unknown> | null>(row.output, null),
    error: parseJson<{ type: string; message: string } | null>(row.error, null),
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  }
}

function connectionRowFrom(input: CreateConnectionInput, timestamp: string) {
  return {
    id: newId('conn'),
    organizationId: input.organizationId,
    projectId: input.projectId,
    connectorId: input.connectorId,
    credentialId: input.credentialId,
    credentialVersionId: input.credentialVersionId,
    endpointUrl: input.endpointUrl,
    approvalMode: input.approvalMode,
    state: 'connected' as const,
    lastError: null,
    metadata: stringify(input.metadata),
    connectedAt: timestamp,
    disconnectedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createConnectionRepo(db: Db): ConnectionRepo {
  return {
    async list(query: ConnectionListQuery): Promise<ListPageResult<ConnectionRecord>> {
      const filters = [
        eq(connections.projectId, query.projectId),
        query.state ? eq(connections.state, query.state) : undefined,
        query.cursor
          ? or(
              lt(connections.createdAt, query.cursor.createdAt),
              and(eq(connections.createdAt, query.cursor.createdAt), lt(connections.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(connections)
        .where(and(...filters))
        .orderBy(desc(connections.createdAt), desc(connections.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(connectionRecordFrom), hasMore }
    },

    async find(projectId, connectionId) {
      const row = await db
        .select()
        .from(connections)
        .where(and(eq(connections.id, connectionId), eq(connections.projectId, projectId)))
        .get()
      return row ? connectionRecordFrom(row) : null
    },

    async findByConnector(projectId, connectorId) {
      const row = await db
        .select()
        .from(connections)
        .where(and(eq(connections.projectId, projectId), eq(connections.connectorId, connectorId)))
        .get()
      return row ? connectionRecordFrom(row) : null
    },

    async insert(input: CreateConnectionInput, timestamp): Promise<ConnectionRecord> {
      const row = connectionRowFrom(input, timestamp)
      await db.insert(connections).values(row)
      return connectionRecordFrom(row)
    },

    async update(connectionId, fields: UpdateConnectionFields, updatedAt): Promise<ConnectionRecord> {
      const set = {
        credentialId: fields.credentialId,
        credentialVersionId: fields.credentialVersionId,
        endpointUrl: fields.endpointUrl,
        approvalMode: fields.approvalMode,
        state: fields.state,
        disconnectedAt: fields.disconnectedAt,
        metadata: stringify(fields.metadata),
        updatedAt,
      }
      await db.update(connections).set(set).where(eq(connections.id, connectionId))
      const row = await db.select().from(connections).where(eq(connections.id, connectionId)).get()
      return connectionRecordFrom(row!)
    },

    async resolveCredential(
      visibility: VaultVisibility,
      ref: { credentialId: string; versionId?: string | undefined } | null,
    ): Promise<ResolvedCredential> {
      if (!ref) {
        return { credentialId: null, credentialVersionId: null }
      }
      const credential = await db
        .select()
        .from(vaultCredentials)
        .where(
          and(
            eq(vaultCredentials.id, ref.credentialId),
            eq(vaultCredentials.organizationId, visibility.organizationId),
            or(eq(vaultCredentials.projectId, visibility.projectId), isNull(vaultCredentials.projectId)),
          ),
        )
        .get()
      if (credential?.state !== 'active') {
        throw new Error('Credential is revoked or unavailable.')
      }
      const effectiveVersionId = ref.versionId ?? credential.activeVersionId
      if (!effectiveVersionId) {
        return { credentialId: credential.id, credentialVersionId: null }
      }
      const version = await db
        .select()
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, effectiveVersionId),
            eq(vaultCredentialVersions.organizationId, visibility.organizationId),
            or(eq(vaultCredentialVersions.projectId, visibility.projectId), isNull(vaultCredentialVersions.projectId)),
          ),
        )
        .get()
      if (version?.state !== 'active') {
        throw new Error('Credential version is revoked or unavailable.')
      }
      if (version.credentialId !== credential.id) {
        throw new Error('Credential version does not belong to the credential.')
      }
      return { credentialId: credential.id, credentialVersionId: version.id }
    },

    async findSession(projectId, sessionId) {
      const session = await db
        .select({
          id: sessions.id,
          agentSnapshot: sessions.agentSnapshot,
          environmentSnapshot: sessions.environmentSnapshot,
        })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
        .get()
      return session ?? null
    },

    async listTools(connectionId) {
      const rows = await db
        .select()
        .from(connectionTools)
        .where(and(eq(connectionTools.connectionId, connectionId), eq(connectionTools.availability, 'available')))
        .orderBy(desc(connectionTools.createdAt), desc(connectionTools.id))
      return rows.map(toolRecordFrom)
    },

    async findTool(connectionId, toolName) {
      const row = await db
        .select()
        .from(connectionTools)
        .where(and(eq(connectionTools.connectionId, connectionId), eq(connectionTools.name, toolName)))
        .get()
      return row ? toolRecordFrom(row) : null
    },

    async replaceCatalogTools(connection: ConnectionRecord, catalogTools: ConnectorCatalogTool[]) {
      const timestamp = now()
      await db.delete(connectionTools).where(eq(connectionTools.connectionId, connection.id))
      if (catalogTools.length === 0) {
        return
      }
      await db.insert(connectionTools).values(
        catalogTools.map((tool) => ({
          id: newId('contool'),
          connectionId: connection.id,
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          connectorId: connection.connectorId,
          name: tool.name,
          description: tool.description,
          inputSchema: stringify(tool.inputSchema),
          approvalMode: connection.approvalMode === 'project_policy' ? tool.approvalMode : connection.approvalMode,
          policyMetadata: stringify(tool.policyMetadata),
          availability: 'available',
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      )
    },

    async replaceServerTools(connection: ConnectionRecord, tools: McpServerToolDescriptor[]) {
      const timestamp = now()
      await db.delete(connectionTools).where(eq(connectionTools.connectionId, connection.id))
      if (tools.length === 0) {
        return
      }
      await db.insert(connectionTools).values(
        tools.map((tool) => ({
          id: newId('contool'),
          connectionId: connection.id,
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          connectorId: connection.connectorId,
          name: tool.name,
          description: tool.description,
          inputSchema: stringify(tool.inputSchema),
          approvalMode: connection.approvalMode,
          policyMetadata: stringify({ source: 'mcp_server' }),
          availability: 'available',
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      )
    },

    async insertToolCall(execution: ToolCallExecution): Promise<ToolCallRecord> {
      const row = {
        id: execution.id,
        organizationId: execution.organizationId,
        projectId: execution.projectId,
        connectionId: execution.connectionId,
        connectorId: execution.connectorId,
        toolName: execution.toolName,
        sessionId: execution.sessionId,
        input: stringify(redactSensitiveValue(execution.input)),
        output: execution.output === null ? null : stringify(redactSensitiveValue(execution.output)),
        state: execution.state,
        error: execution.error === null ? null : stringify(execution.error),
        durationMs: execution.durationMs,
        createdAt: execution.createdAt,
      }
      await db.insert(toolCalls).values(row)
      return toolCallRecordFrom(row)
    },

    async listToolCalls(query: ToolCallListQuery): Promise<ListPageResult<ToolCallRecord>> {
      const filters = [
        eq(toolCalls.projectId, query.projectId),
        eq(toolCalls.connectionId, query.connectionId),
        eq(toolCalls.toolName, query.toolName),
        query.cursor
          ? or(
              lt(toolCalls.createdAt, query.cursor.createdAt),
              and(eq(toolCalls.createdAt, query.cursor.createdAt), lt(toolCalls.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(toolCalls)
        .where(and(...filters))
        .orderBy(desc(toolCalls.createdAt), desc(toolCalls.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(toolCallRecordFrom), hasMore }
    },

    async findToolCall(projectId, connectionId, toolName, callId) {
      const row = await db
        .select()
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.id, callId),
            eq(toolCalls.projectId, projectId),
            eq(toolCalls.connectionId, connectionId),
            eq(toolCalls.toolName, toolName),
          ),
        )
        .get()
      return row ? toolCallRecordFrom(row) : null
    },
  }
}
