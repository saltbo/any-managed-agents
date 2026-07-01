import { describe, expect, it } from 'vitest'
import { AmaSandboxToolCallSchema, parseAmaSandboxToolInput, parseAmaSandboxToolOutput } from './tool-contracts'

describe('AMA sandbox tool contracts', () => {
  it('defines strict inputs for every executable tool', () => {
    expect(parseAmaSandboxToolInput('bash', { command: 'pwd', timeout: 1000 })).toEqual({
      command: 'pwd',
      timeout: 1000,
    })
    expect(parseAmaSandboxToolInput('read', { path: 'README.md', offset: 0, limit: 10 })).toEqual({
      path: 'README.md',
      offset: 0,
      limit: 10,
    })
    expect(parseAmaSandboxToolInput('write', { path: 'a.txt', content: 'hello' })).toEqual({
      path: 'a.txt',
      content: 'hello',
    })
    expect(parseAmaSandboxToolInput('edit', { path: 'a.txt', edits: [{ oldText: 'a', newText: 'b' }] })).toEqual({
      path: 'a.txt',
      edits: [{ oldText: 'a', newText: 'b' }],
    })
    expect(parseAmaSandboxToolInput('grep', { pattern: 'needle', path: '.', literal: true, limit: 5 })).toEqual({
      pattern: 'needle',
      path: '.',
      literal: true,
      limit: 5,
    })
    expect(parseAmaSandboxToolInput('find', { pattern: 'test', glob: '**/*.test.ts', path: '.', limit: 20 })).toEqual({
      pattern: 'test',
      glob: '**/*.test.ts',
      path: '.',
      limit: 20,
    })
    expect(parseAmaSandboxToolInput('ls', { path: '.', limit: 20 })).toEqual({ path: '.', limit: 20 })
    expect(parseAmaSandboxToolInput('fetch', { url: 'https://example.com' })).toEqual({
      url: 'https://example.com',
    })
    expect(parseAmaSandboxToolInput('web_search', { query: 'managed agents', limit: 10 })).toEqual({
      query: 'managed agents',
      limit: 10,
    })
  })

  it('defines strict outputs for every executable tool', () => {
    const commandOutput = { stdout: 'ok', stderr: '', exitCode: 0 }
    expect(parseAmaSandboxToolOutput('bash', commandOutput)).toEqual(commandOutput)
    expect(parseAmaSandboxToolOutput('grep', commandOutput)).toEqual(commandOutput)
    expect(parseAmaSandboxToolOutput('find', commandOutput)).toEqual(commandOutput)
    expect(parseAmaSandboxToolOutput('ls', commandOutput)).toEqual(commandOutput)
    expect(parseAmaSandboxToolOutput('fetch', commandOutput)).toEqual(commandOutput)
    expect(parseAmaSandboxToolOutput('web_search', commandOutput)).toEqual(commandOutput)
    expect(parseAmaSandboxToolOutput('read', { content: 'hello', path: 'a.txt' })).toEqual({
      content: 'hello',
      path: 'a.txt',
    })
    expect(parseAmaSandboxToolOutput('write', { ok: true, path: 'a.txt', bytes: 5 })).toEqual({
      ok: true,
      path: 'a.txt',
      bytes: 5,
    })
    expect(parseAmaSandboxToolOutput('edit', { ok: true, path: 'a.txt' })).toEqual({ ok: true, path: 'a.txt' })
  })

  it('rejects loose inputs for known executable tool names', () => {
    expect(
      AmaSandboxToolCallSchema.safeParse({ id: 'call_1', name: 'bash', input: { path: 'README.md' } }).success,
    ).toBe(false)
    expect(() => parseAmaSandboxToolInput('read', { path: 'README.md', extra: true })).toThrow()
    expect(() => parseAmaSandboxToolInput('find', { path: '.' })).toThrow()
  })
})
