import { type Schema, Validator } from '@cfworker/json-schema'
import type {
  McpCallResult,
  McpConnectionTarget,
  McpGateway,
  McpServerToolDescriptor,
  McpToolError,
} from '@server/usecases/ports'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { vaultCredentials, vaultCredentialVersions } from '../../db/schema'
import type { Env } from '../../env'
import {
  callMcpServerTool,
  categorizeMcpClientFailure,
  listMcpServerTools,
  McpClientError,
  type McpClientErrorCategory,
  type McpClientTarget,
} from './mcp-client'
import { resolveRuntimeEnvFrom } from './runtime-secrets'

type Db = ReturnType<typeof drizzle>

// Stable error surface for connector failures. Raw connector error text never
// reaches API responses, audit metadata, or session events.
const NORMALIZED_MCP_ERRORS: Record<McpClientErrorCategory, McpToolError> = {
  unauthorized: { type: 'mcp_unauthorized', message: 'MCP server rejected the connection credential.' },
  not_found: { type: 'mcp_not_found', message: 'MCP server or tool was not found.' },
  timeout: { type: 'mcp_timeout', message: 'MCP server did not respond before the configured timeout.' },
  invalid_schema: { type: 'mcp_invalid_schema', message: 'MCP server rejected the tool input schema.' },
  network: { type: 'mcp_network_error', message: 'MCP server could not be reached.' },
  upstream: { type: 'mcp_upstream_error', message: 'MCP tool call failed.' },
}

export function normalizedMcpError(error: unknown): McpToolError {
  return NORMALIZED_MCP_ERRORS[categorizeMcpClientFailure(error)]
}

// The MCP client boundary (fetch). Resolves the connection credential to an
// Authorization header, lists tools from a live server, and calls a tool.
// Failures are categorized into the stable McpToolError surface. Request-free:
// the vault scope rides on each target so the gateway lives in Deps.
export function createMcpGateway(env: Env, db: Db): McpGateway {
  return {
    upstreamError: NORMALIZED_MCP_ERRORS.upstream,

    normalizeError(error: unknown) {
      return normalizedMcpError(error)
    },

    validateToolInput(schema: Record<string, unknown>, input: Record<string, unknown>) {
      // Spec-conformant MCP servers report input validation failures as opaque
      // in-band tool errors, so the control plane validates at its own boundary
      // to keep the stable invalid_schema category.
      if (Object.keys(schema).length === 0) {
        return
      }
      const result = new Validator(schema as Schema, '2020-12', false).validate(input)
      if (!result.valid) {
        throw new McpClientError('invalid_schema', result.errors)
      }
    },

    async listTools(target: McpConnectionTarget): Promise<McpServerToolDescriptor[]> {
      const clientTarget = await resolveTarget(env, db, target)
      const tools = await listMcpServerTools(clientTarget)
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
    },

    async callTool(target: McpConnectionTarget, values: { toolName: string; input: Record<string, unknown> }) {
      const clientTarget = await resolveTarget(env, db, target)
      const result = await callMcpServerTool(clientTarget, values)
      const output: McpCallResult = {
        content: result.content,
        structuredContent: result.structuredContent,
        isError: result.isError,
      }
      if (result.isError) {
        throw new McpClientError('upstream', result)
      }
      return output
    },
  }
}

async function resolveTarget(env: Env, db: Db, target: McpConnectionTarget): Promise<McpClientTarget> {
  return {
    endpointUrl: target.endpointUrl,
    authorization: await resolveAuthorization(env, db, target),
    timeoutMs: target.timeoutMs,
  }
}

// Resolves the connection credential to an Authorization header value. The
// credential's active version wins over the version pinned at connect time so
// rotated credentials take effect without reconnecting.
async function resolveAuthorization(env: Env, db: Db, target: McpConnectionTarget) {
  const credentialId = target.credentialId
  if (!credentialId) {
    return null
  }
  const credential = await db
    .select({ activeVersionId: vaultCredentials.activeVersionId })
    .from(vaultCredentials)
    .where(
      and(
        eq(vaultCredentials.id, credentialId),
        eq(vaultCredentials.organizationId, target.organizationId),
        or(eq(vaultCredentials.projectId, target.projectId), isNull(vaultCredentials.projectId)),
      ),
    )
    .get()
  const versionId = credential?.activeVersionId ?? target.credentialVersionId ?? undefined
  if (!versionId) {
    return null
  }
  const version = await db
    .select({ secretRef: vaultCredentialVersions.secretRef })
    .from(vaultCredentialVersions)
    .where(
      and(
        eq(vaultCredentialVersions.id, versionId),
        eq(vaultCredentialVersions.credentialId, credentialId),
        eq(vaultCredentialVersions.organizationId, target.organizationId),
        or(eq(vaultCredentialVersions.projectId, target.projectId), isNull(vaultCredentialVersions.projectId)),
      ),
    )
    .get()
  if (!version) {
    return null
  }
  let resolved: Record<string, string>
  try {
    resolved = await resolveRuntimeEnvFrom(
      env,
      db,
      { organizationId: target.organizationId, projectId: target.projectId },
      [{ type: 'secret', name: 'credential', secretRef: version.secretRef }],
    )
  } catch (error) {
    throw new McpClientError('unauthorized', error)
  }
  const value = resolved.credential
  return typeof value === 'string' ? `Bearer ${value}` : null
}
