import { describe, expect, it } from 'vitest'
import { parseRuntimeProxyRoute, runtimeRequestHasTestOnlyFields } from './proxy-route'

describe('runtime request validation', () => {
  it('identifies client-supplied runtime fixture fields that are rejected outside test mode', () => {
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello' })).toBe(false)
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello', toolCalls: [] })).toBe(true)
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello', simulateError: true })).toBe(true)
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello', response: 'canned' })).toBe(true)
  })
})

describe('parseRuntimeProxyRoute', () => {
  it('classifies the WebSocket upgrade path', () => {
    expect(parseRuntimeProxyRoute('/ws', 'GET')).toEqual({ kind: 'ws' })
  })

  it('does not classify MCP tool call paths as AMA proxy operations', () => {
    expect(parseRuntimeProxyRoute('/mcp/connector%20one/tools/tool%2Fname/calls', 'POST')).toEqual({
      kind: 'passthrough',
    })
    expect(parseRuntimeProxyRoute('/mcp/c/tools/t/calls', 'GET')).toEqual({ kind: 'passthrough' })
  })

  it('classifies an rpc POST', () => {
    expect(parseRuntimeProxyRoute('/rpc', 'POST')).toEqual({ kind: 'rpc' })
  })

  it('treats a non-POST rpc path as passthrough', () => {
    expect(parseRuntimeProxyRoute('/rpc', 'GET')).toEqual({ kind: 'passthrough' })
  })

  it('treats sandbox operation paths as passthrough', () => {
    expect(parseRuntimeProxyRoute('/sandbox/exec', 'POST')).toEqual({ kind: 'passthrough' })
  })
})
