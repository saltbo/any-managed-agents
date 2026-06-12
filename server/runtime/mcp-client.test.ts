import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'
import { categorizeMcpClientFailure, McpClientError } from './mcp-client'

describe('categorizeMcpClientFailure', () => {
  it('maps HTTP transport statuses to stable categories', () => {
    expect(categorizeMcpClientFailure(new StreamableHTTPError(401, 'raw upstream auth detail'))).toBe('unauthorized')
    expect(categorizeMcpClientFailure(new StreamableHTTPError(403, 'raw upstream auth detail'))).toBe('unauthorized')
    expect(categorizeMcpClientFailure(new StreamableHTTPError(404, 'raw upstream missing detail'))).toBe('not_found')
    expect(categorizeMcpClientFailure(new StreamableHTTPError(504, 'raw upstream timeout detail'))).toBe('timeout')
    expect(categorizeMcpClientFailure(new StreamableHTTPError(500, 'raw upstream crash detail'))).toBe('upstream')
  })

  it('maps JSON-RPC protocol errors to stable categories', () => {
    expect(categorizeMcpClientFailure(new McpError(ErrorCode.RequestTimeout, 'raw timeout detail'))).toBe('timeout')
    expect(categorizeMcpClientFailure(new McpError(ErrorCode.InvalidParams, 'raw schema detail'))).toBe(
      'invalid_schema',
    )
    expect(categorizeMcpClientFailure(new McpError(ErrorCode.MethodNotFound, 'raw missing detail'))).toBe('not_found')
    expect(categorizeMcpClientFailure(new McpError(ErrorCode.InternalError, 'raw internal detail'))).toBe('upstream')
  })

  it('maps fetch connection failures to the network category', () => {
    expect(categorizeMcpClientFailure(new TypeError('fetch failed: connection refused'))).toBe('network')
    // workerd raises a plain Error for severed or refused connections.
    expect(categorizeMcpClientFailure(new Error('Network connection lost.'))).toBe('network')
    expect(categorizeMcpClientFailure(new Error('connect ECONNREFUSED 127.0.0.1:9'))).toBe('network')
  })

  it('keeps the category of already-wrapped client errors', () => {
    const wrapped = new McpClientError('invalid_schema', new Error('raw cause detail'))
    expect(categorizeMcpClientFailure(wrapped)).toBe('invalid_schema')
  })

  it('falls back to upstream for unknown failures and never exposes raw detail in the safe message', () => {
    const error = new McpClientError(categorizeMcpClientFailure(new Error('raw upstream detail')), new Error('raw'))
    expect(error.category).toBe('upstream')
    expect(error.message).not.toContain('raw upstream detail')
  })
})
