// Emits the canonical OpenAPI snapshot from the Hono routes, then drives each
// language's community generator to produce its SDK from that snapshot.
//
//   sdk/openapi.json   <- route-generated OpenAPI 3.0 document (source of truth)
//   sdk/typescript     <- @hey-api/openapi-ts        (pnpm run generate)
//   sdk/go             <- oapi-codegen               (oapi-codegen -config ...)
//   sdk/python         <- openapi-python-client      (openapi-python-client generate ...)
//   sdk/spec           <- stable facade shape shared by all language SDKs
//
// `--check` regenerates everything and fails if any committed artifact drifts,
// which is how CI verifies the SDKs stay in sync with the contract. It requires
// all three toolchains (pnpm, oapi-codegen on PATH, openapi-python-client on
// PATH) to be installed.

import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createApp } from '../server/app'
import type { Env } from '../server/env'

type OpenApiDocument = {
  openapi: string
  paths: Record<string, Record<string, { operationId?: string }>>
}

const ROOT = path.join(import.meta.dirname, '..')

async function main() {
  const check = process.argv.includes('--check')

  // 1. Emit the canonical OpenAPI snapshot from the live Hono routes.
  const document = await routeGeneratedOpenApi()
  await writeFile(path.join(ROOT, 'sdk/openapi.json'), `${JSON.stringify(document, null, 2)}\n`)

  // 2. Drive each language's generator from that snapshot.
  generateTypeScriptSdk()
  generateGoSdk()
  generatePythonSdk()
  generateSdkFacades()

  // 3. In check mode, fail if regeneration changed any committed artifact.
  if (check) {
    run('git', ['diff', '--exit-code', '--', 'sdk'], ROOT)
  }
}

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function generateTypeScriptSdk() {
  run('pnpm', ['--filter', '@any-managed-agents/sdk', 'run', 'generate'], ROOT)
}

function generateGoSdk() {
  run('oapi-codegen', ['-config', 'oapi-codegen.config.yaml', '../openapi.json'], path.join(ROOT, 'sdk/go'))
}

function generatePythonSdk() {
  // openapi-python-client refuses to overwrite a package it did not create, so
  // remove the previous output first; `--meta none` keeps the hand-maintained
  // pyproject.toml. py.typed is re-added because `--meta none` omits it.
  const sdkDir = path.join(ROOT, 'sdk/python')
  execFileSync('rm', ['-rf', 'ama_sdk'], { cwd: sdkDir, stdio: 'inherit' })
  run(
    'openapi-python-client',
    ['generate', '--path', '../openapi.json', '--config', 'openapi-python-client.config.yaml', '--meta', 'none', '--output-path', 'ama_sdk', '--overwrite'],
    sdkDir,
  )
  execFileSync('touch', ['ama_sdk/py.typed'], { cwd: sdkDir, stdio: 'inherit' })
}

function generateSdkFacades() {
  run('node', ['scripts/generate-sdk-facades.mjs'], ROOT)
}

async function routeGeneratedOpenApi() {
  const app = createApp()
  const response = await app.fetch(new Request('https://example.test/api/v1/openapi.json'), {} as Env)
  if (!response.ok) {
    throw new Error(`OpenAPI generation failed with HTTP ${response.status}`)
  }
  return (await response.json()) as OpenApiDocument
}

await main()
