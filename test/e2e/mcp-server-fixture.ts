import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

// Marker embedded in every raw fixture error so specs can prove raw connector
// error text never leaks through AMA API responses, events, or audit records.
export const MCP_FIXTURE_RAW_ERROR_MARKER = 'mcp-fixture-raw-error-detail'

export interface McpFixtureRecordedCall {
  method: string
  toolName: string | null
  authorization: string | null
}

export interface McpFixtureServer {
  url: string
  port: number
  setAcceptedTokens(tokens: string[]): void
  recordedCalls(): McpFixtureRecordedCall[]
  requestCount(): number
  close(): Promise<void>
}

// Local streamable-HTTP MCP server with deterministic tools. Each request is
// served by a fresh stateless server/transport pair, so the AMA worker can
// initialize, list, and call without session affinity.
export async function startMcpFixtureServer(acceptedTokens: string[]): Promise<McpFixtureServer> {
  let tokens = [...acceptedTokens]
  const calls: McpFixtureRecordedCall[] = []
  let requests = 0

  const httpServer = createServer((request, response) => {
    requests += 1
    handleRequest(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain' })
      }
      response.end(`${MCP_FIXTURE_RAW_ERROR_MARKER}: fixture request handling failed`)
    })
  })

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/mcp') {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end(`${MCP_FIXTURE_RAW_ERROR_MARKER}: no MCP endpoint at ${url.pathname}`)
      return
    }
    if (request.method === 'GET' || request.method === 'DELETE') {
      response.writeHead(405, { 'content-type': 'text/plain' })
      response.end('fixture serves POST-only stateless MCP')
      return
    }
    const body = await readJsonBody(request)
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const params = record.params && typeof record.params === 'object' ? (record.params as Record<string, unknown>) : {}
    calls.push({
      method: typeof record.method === 'string' ? record.method : 'unknown',
      toolName: typeof params.name === 'string' ? params.name : null,
      authorization: request.headers.authorization ?? null,
    })
    const authorized = tokens.some((token) => request.headers.authorization === `Bearer ${token}`)
    if (!authorized) {
      response.writeHead(401, { 'content-type': 'text/plain' })
      response.end(`${MCP_FIXTURE_RAW_ERROR_MARKER}: fixture rejected the presented credential`)
      return
    }
    const server = buildFixtureMcpServer()
    // No sessionIdGenerator: stateless mode, one server/transport per request.
    const transport = new StreamableHTTPServerTransport({})
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
    // The SDK transport types optional callbacks as `T | undefined`, which
    // clashes with exactOptionalPropertyTypes on the Transport interface.
    await server.connect(transport as Parameters<typeof server.connect>[0])
    await transport.handleRequest(request, response, body)
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })
  const address = httpServer.address()
  if (address === null || typeof address === 'string') {
    throw new Error('MCP fixture server did not bind to a local port')
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    port: address.port,
    setAcceptedTokens(next: string[]) {
      tokens = [...next]
    },
    recordedCalls: () => [...calls],
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()))
        httpServer.closeAllConnections()
      }),
  }
}

// Allocates a port that nothing listens on, for transport-failure scenarios.
export async function allocateDeadPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => resolve())
  })
  const address = probe.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Could not allocate a dead port')
  }
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()))
  })
  return address.port
}

function buildFixtureMcpServer() {
  const server = new McpServer({ name: 'ama-e2e-mcp-fixture', version: '1.0.0' })
  server.registerTool(
    'echo',
    {
      description: 'Echo the provided text back to the caller.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({
      content: [{ type: 'text', text: `echo:${text}` }],
      structuredContent: { echoed: text },
    }),
  )
  server.registerTool(
    'add',
    {
      description: 'Add two numbers and return the sum.',
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
      structuredContent: { sum: a + b },
    }),
  )
  server.registerTool(
    'slow',
    {
      description: 'Wait two seconds before responding; used for timeout scenarios.',
      inputSchema: {},
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      return { content: [{ type: 'text', text: 'finally done' }] }
    },
  )
  return server
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) {
    return undefined
  }
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
