import type { McpConnectionTarget } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

// --- hoisted mocks ---

const listMcpServerToolsMock = vi.fn()
const callMcpServerToolMock = vi.fn()
const categorizeMcpClientFailureMock = vi.fn()
const resolveRuntimeSecretEnvMock = vi.fn()

vi.mock('./mcp-client', () => ({
  listMcpServerTools: listMcpServerToolsMock,
  callMcpServerTool: callMcpServerToolMock,
  categorizeMcpClientFailure: categorizeMcpClientFailureMock,
  McpClientError: class McpClientError extends Error {
    readonly category: string
    constructor(category: string, cause: unknown) {
      super(`MCP client ${category} failure`, { cause })
      this.category = category
    }
  },
}))

vi.mock('./runtime-secret-env', () => ({
  resolveRuntimeSecretEnv: resolveRuntimeSecretEnvMock,
}))

// Import under test after mocks are registered
const { createMcpGateway, normalizedMcpError } = await import('./mcp')

const env = { AMA_VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as unknown as Env

function makeDb(credentialRow: { activeVersionId: string | null } | undefined = undefined) {
  const getMock = vi.fn().mockResolvedValue(credentialRow)
  const whereMock = vi.fn().mockReturnValue({ get: getMock })
  const fromMock = vi.fn().mockReturnValue({ where: whereMock })
  const selectMock = vi.fn().mockReturnValue({ from: fromMock })
  return { select: selectMock } as unknown as Parameters<typeof createMcpGateway>[1]
}

const baseTarget: McpConnectionTarget = {
  organizationId: 'org_1',
  projectId: 'project_1',
  endpointUrl: 'https://mcp.example.com/sse',
  timeoutMs: 5000,
  credentialId: null,
  credentialVersionId: null,
}

describe('[spec: mcp/gateway] normalizedMcpError', () => {
  it('maps categorizeMcpClientFailure result to the stable error surface', () => {
    categorizeMcpClientFailureMock.mockReturnValue('unauthorized')
    const err = normalizedMcpError(new Error('raw upstream detail'))
    expect(err.type).toBe('mcp_unauthorized')
    expect(err.message).not.toContain('raw upstream detail')
  })

  it('maps network category to the network error surface', () => {
    categorizeMcpClientFailureMock.mockReturnValue('network')
    const err = normalizedMcpError(new TypeError('fetch failed'))
    expect(err.type).toBe('mcp_network_error')
  })

  it('maps timeout category to the timeout error surface', () => {
    categorizeMcpClientFailureMock.mockReturnValue('timeout')
    const err = normalizedMcpError(new Error('timed out'))
    expect(err.type).toBe('mcp_timeout')
  })

  it('maps not_found category to the not_found error surface', () => {
    categorizeMcpClientFailureMock.mockReturnValue('not_found')
    const err = normalizedMcpError(new Error('not found'))
    expect(err.type).toBe('mcp_not_found')
  })

  it('maps invalid_schema category to the invalid_schema error surface', () => {
    categorizeMcpClientFailureMock.mockReturnValue('invalid_schema')
    const err = normalizedMcpError(new Error('bad schema'))
    expect(err.type).toBe('mcp_invalid_schema')
  })

  it('maps upstream category to the upstream error surface', () => {
    categorizeMcpClientFailureMock.mockReturnValue('upstream')
    const err = normalizedMcpError(new Error('upstream'))
    expect(err.type).toBe('mcp_upstream_error')
  })
})

describe('[spec: mcp/gateway] createMcpGateway — shape', () => {
  it('exposes the stable upstream error on the gateway', () => {
    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    expect(gateway.upstreamError.type).toBe('mcp_upstream_error')
  })

  it('normalizeError maps via categorizeMcpClientFailure', () => {
    categorizeMcpClientFailureMock.mockReturnValue('network')
    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    const err = gateway.normalizeError(new TypeError('fetch failed'))
    expect(err.type).toBe('mcp_network_error')
  })
})

describe('[spec: mcp/gateway] createMcpGateway — validateToolInput', () => {
  it('passes when the schema is empty (no validation)', () => {
    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    expect(() => gateway.validateToolInput({}, { anyKey: 'value' })).not.toThrow()
  })

  it('passes when input satisfies the schema', () => {
    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
    expect(() => gateway.validateToolInput(schema, { name: 'hello' })).not.toThrow()
  })

  it('throws McpClientError(invalid_schema) when input violates the schema', () => {
    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
    expect(() => gateway.validateToolInput(schema, {})).toThrow()
  })
})

describe('[spec: mcp/gateway] createMcpGateway — listTools', () => {
  it('lists tools without a credential when credentialId is null', async () => {
    listMcpServerToolsMock.mockResolvedValueOnce([
      { name: 'bash', description: 'Run a shell command', inputSchema: { type: 'object' } },
    ])

    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    const tools = await gateway.listTools(baseTarget)

    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('bash')
    expect(tools[0]?.description).toBe('Run a shell command')
    expect(listMcpServerToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpointUrl: baseTarget.endpointUrl, authorization: null }),
    )
  })

  it('resolves the credential and passes the Bearer token when credentialId is set', async () => {
    resolveRuntimeSecretEnvMock.mockResolvedValueOnce({ credential: 'my-api-token' })
    listMcpServerToolsMock.mockResolvedValueOnce([])

    const db = makeDb({ activeVersionId: 'ver_1' })
    const gateway = createMcpGateway(env, db)
    const target: McpConnectionTarget = { ...baseTarget, credentialId: 'cred_1', credentialVersionId: 'ver_0' }
    await gateway.listTools(target)

    expect(listMcpServerToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({ authorization: 'Bearer my-api-token' }),
    )
  })

  it('falls back to credentialVersionId from target when activeVersionId is null', async () => {
    resolveRuntimeSecretEnvMock.mockResolvedValueOnce({ credential: 'fallback-token' })
    listMcpServerToolsMock.mockResolvedValueOnce([])

    // Simulate no matching credential row
    const db = makeDb(undefined)
    const gateway = createMcpGateway(env, db)
    const target: McpConnectionTarget = { ...baseTarget, credentialId: 'cred_1', credentialVersionId: 'ver_pinned' }
    await gateway.listTools(target)

    const [, , , itemsArg] = resolveRuntimeSecretEnvMock.mock.calls.at(-1) ?? []
    const firstItem = Array.isArray(itemsArg) ? itemsArg[0] : null
    expect(firstItem?.credentialRef?.versionId).toBe('ver_pinned')
  })

  it('passes null authorization when the resolved credential value is not a string', async () => {
    resolveRuntimeSecretEnvMock.mockResolvedValueOnce({ credential: undefined })
    listMcpServerToolsMock.mockResolvedValueOnce([])

    const db = makeDb({ activeVersionId: 'ver_1' })
    const gateway = createMcpGateway(env, db)
    const target: McpConnectionTarget = { ...baseTarget, credentialId: 'cred_1', credentialVersionId: null }
    await gateway.listTools(target)

    expect(listMcpServerToolsMock).toHaveBeenCalledWith(expect.objectContaining({ authorization: null }))
  })

  it('uses undefined versionId when both activeVersionId and credentialVersionId are null', async () => {
    resolveRuntimeSecretEnvMock.mockResolvedValueOnce({ credential: 'token' })
    listMcpServerToolsMock.mockResolvedValueOnce([])

    // credential row exists but activeVersionId is null; target also has null credentialVersionId
    const db = makeDb({ activeVersionId: null })
    const gateway = createMcpGateway(env, db)
    const target: McpConnectionTarget = { ...baseTarget, credentialId: 'cred_1', credentialVersionId: null }
    await gateway.listTools(target)

    const [, , , itemsArg] = resolveRuntimeSecretEnvMock.mock.calls.at(-1) ?? []
    const firstItem = Array.isArray(itemsArg) ? itemsArg[0] : null
    // versionId should be undefined (not null, not a string)
    expect(firstItem?.credentialRef?.versionId).toBeUndefined()
  })

  it('wraps resolveRuntimeSecretEnv rejection as McpClientError(unauthorized)', async () => {
    resolveRuntimeSecretEnvMock.mockRejectedValueOnce(new Error('vault revoked'))
    listMcpServerToolsMock.mockResolvedValueOnce([])

    const db = makeDb({ activeVersionId: 'ver_1' })
    const gateway = createMcpGateway(env, db)
    const target: McpConnectionTarget = { ...baseTarget, credentialId: 'cred_1', credentialVersionId: null }
    await expect(gateway.listTools(target)).rejects.toMatchObject({ category: 'unauthorized' })
  })

  it('passes the timeoutMs through to the client target', async () => {
    listMcpServerToolsMock.mockResolvedValueOnce([])
    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    await gateway.listTools({ ...baseTarget, timeoutMs: 12345 })
    expect(listMcpServerToolsMock).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 12345 }))
  })
})

describe('[spec: mcp/gateway] createMcpGateway — callTool', () => {
  it('returns the tool call result when isError is false', async () => {
    callMcpServerToolMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'hello' }],
      structuredContent: null,
      isError: false,
    })

    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    const result = await gateway.callTool(baseTarget, { toolName: 'bash', input: { cmd: 'ls' } })

    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.isError).toBe(false)
  })

  it('throws McpClientError(upstream) when the tool call result has isError true', async () => {
    callMcpServerToolMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'error occurred' }],
      structuredContent: null,
      isError: true,
    })

    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    await expect(
      gateway.callTool(baseTarget, { toolName: 'bash', input: { cmd: 'bad-command' } }),
    ).rejects.toMatchObject({ category: 'upstream' })
  })

  it('includes structuredContent in the output', async () => {
    callMcpServerToolMock.mockResolvedValueOnce({
      content: [],
      structuredContent: { result: 42 },
      isError: false,
    })

    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    const result = await gateway.callTool(baseTarget, { toolName: 'compute', input: {} })
    expect(result.structuredContent).toEqual({ result: 42 })
  })

  it('propagates listMcpServerTools rejection', async () => {
    callMcpServerToolMock.mockRejectedValueOnce(new Error('connection refused'))

    const db = makeDb()
    const gateway = createMcpGateway(env, db)
    await expect(gateway.callTool(baseTarget, { toolName: 'bash', input: {} })).rejects.toThrow('connection refused')
  })
})
