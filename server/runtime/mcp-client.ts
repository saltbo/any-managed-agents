import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

// Stable categories for connector failures. Raw connector error text stays on
// the server side; API responses and session events only carry the category
// and its fixed safe message.
export type McpClientErrorCategory =
  | 'unauthorized'
  | 'not_found'
  | 'timeout'
  | 'invalid_schema'
  | 'network'
  | 'upstream'

export class McpClientError extends Error {
  readonly category: McpClientErrorCategory

  constructor(category: McpClientErrorCategory, cause: unknown) {
    super(`MCP client ${category} failure`, { cause })
    this.category = category
  }
}

export interface McpClientTarget {
  endpointUrl: string
  authorization: string | null
  timeoutMs: number
}

export interface McpServerTool {
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
}

export interface McpToolCallResult {
  content: unknown[]
  structuredContent: Record<string, unknown> | null
  isError: boolean
}

export function categorizeMcpClientFailure(error: unknown): McpClientErrorCategory {
  if (error instanceof McpClientError) {
    return error.category
  }
  if (error instanceof StreamableHTTPError) {
    if (error.code === 401 || error.code === 403) return 'unauthorized'
    if (error.code === 404 || error.code === 405) return 'not_found'
    if (error.code === 408 || error.code === 504) return 'timeout'
    return 'upstream'
  }
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) return 'timeout'
    if (error.code === ErrorCode.InvalidParams) return 'invalid_schema'
    if (error.code === ErrorCode.MethodNotFound) return 'not_found'
    return 'upstream'
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'timeout'
  }
  // Unreachable endpoints surface as a TypeError from standard fetch and as a
  // plain Error with a connection message from the Workers runtime.
  if (error instanceof TypeError) {
    return 'network'
  }
  if (
    error instanceof Error &&
    /network connection lost|fetch failed|econnrefused|econnreset|connection refused|getaddrinfo|socket/i.test(
      error.message,
    )
  ) {
    return 'network'
  }
  return 'upstream'
}

export async function listMcpServerTools(target: McpClientTarget): Promise<McpServerTool[]> {
  return await withMcpClient(target, async (client) => {
    const result = await client.listTools(undefined, { timeout: target.timeoutMs })
    return result.tools.map((tool) => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : null,
      inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
    }))
  })
}

export async function callMcpServerTool(
  target: McpClientTarget,
  values: { toolName: string; input: Record<string, unknown> },
): Promise<McpToolCallResult> {
  return await withMcpClient(target, async (client) => {
    const result = await client.callTool({ name: values.toolName, arguments: values.input }, undefined, {
      timeout: target.timeoutMs,
    })
    return {
      content: Array.isArray(result.content) ? result.content : [],
      structuredContent:
        result.structuredContent && typeof result.structuredContent === 'object'
          ? (result.structuredContent as Record<string, unknown>)
          : null,
      isError: result.isError === true,
    }
  })
}

async function withMcpClient<T>(target: McpClientTarget, operation: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(target.endpointUrl), {
    requestInit: target.authorization ? { headers: { authorization: target.authorization } } : {},
  })
  const client = new Client({ name: 'ama-control-plane', version: '0.1.0' })
  try {
    // The SDK transport types sessionId as `string | undefined`, which clashes
    // with exactOptionalPropertyTypes on the Transport interface.
    await client.connect(transport as Transport, { timeout: target.timeoutMs })
    return await operation(client)
  } catch (error) {
    throw new McpClientError(categorizeMcpClientFailure(error), error)
  } finally {
    await client.close().catch(() => {})
  }
}
