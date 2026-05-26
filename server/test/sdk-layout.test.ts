import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('generated SDK layout', () => {
  it('keeps generated OpenAPI and SDK artifacts aligned with Hono routes', () => {
    expect(() => execFileSync('npm', ['run', 'openapi:check'], { encoding: 'utf8' })).not.toThrow()
  })

  it('keeps only the TypeScript SDK in npm workspaces', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { workspaces?: string[] }
    const sdkPackage = JSON.parse(readFileSync('sdk/typescript/package.json', 'utf8')) as { name?: string }

    expect(rootPackage.workspaces).toEqual(['sdk/typescript'])
    expect(sdkPackage.name).toBe('@any-managed-agents/sdk')
    expect(readFileSync('sdk/go/go.mod', 'utf8')).toMatch(/^module github\.com\/saltbo\/any-managed-agents\/sdk\/go/m)
    expect(readFileSync('sdk/python/pyproject.toml', 'utf8')).toMatch(/^name = "any-managed-agents-sdk"/m)
  })

  it('builds an importable TypeScript SDK package', () => {
    expect(() =>
      execFileSync('npm', ['run', '--workspace', 'sdk/typescript', 'smoke'], { encoding: 'utf8' }),
    ).not.toThrow()
  })

  it('keeps the web console on the shared Hono RPC client', () => {
    const apiClient = readFileSync('src/lib/api.ts', 'utf8')

    expect(apiClient).toMatch(/hc<AppType>/)
    expect(apiClient).toMatch(/x-ama-client['"]?: ['"]web-rpc/)
    expect(apiClient).not.toMatch(/@any-managed-agents\/sdk/)
  })
})
