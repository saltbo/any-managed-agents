import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../../server/app'
import type { Env } from '../../server/env'

export interface RestishDiscoveryResult {
  commands: string[]
  expectedCommands: string[]
  missingCommands: string[]
  documentedCommands: string[]
  undocumentedCommands: string[]
  healthName: string
}

export interface RestishWorkflowResult {
  environmentErrorType: string
  agentErrorType: string
  sessionErrorType: string
}

export interface RestishJsonOutputResult {
  healthName: string
  errorType: string
}

export interface RestishOpenApiHarness {
  origin: string
  discover(): Promise<RestishDiscoveryResult>
  readJsonOutput(): Promise<RestishJsonOutputResult>
  createResourceWorkflow(): Promise<RestishWorkflowResult>
  close(): Promise<void>
}

function configDir(home: string) {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'restish')
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'restish')
  }
  return path.join(home, '.config', 'restish')
}

interface RestishRunResult {
  status: number | null
  stdout: string
  stderr: string
}

function runRestishRaw(home: string, args: string[], input?: unknown) {
  return new Promise<RestishRunResult>((resolve, reject) => {
    const child = spawn('restish', args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        APPDATA: path.join(home, 'AppData', 'Roaming'),
      },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(
        new Error(
          [
            `restish ${args.join(' ')} timed out`,
            Buffer.concat(stdout).toString('utf8'),
            Buffer.concat(stderr).toString('utf8'),
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      )
    }, 60_000)

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        status: code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input))
  })
}

async function runRestish(home: string, args: string[], input?: unknown) {
  const result = await runRestishRaw(home, args, input)
  if (result.status !== 0) {
    throw new Error(
      [`restish ${args.join(' ')} failed with status ${result.status}`, result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n'),
    )
  }
  return result.stdout
}

function parseRestishError(result: RestishRunResult) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  const jsonMatch = output.match(/\{[\s\S]*"error"[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Expected restish output to include a JSON error envelope:\n${output}`)
  }
  const parsed = JSON.parse(jsonMatch[0]) as { error?: { type?: string } }
  if (!parsed.error?.type) {
    throw new Error(`Expected restish JSON output to include error.type:\n${jsonMatch[0]}`)
  }
  return parsed.error.type
}

function parseRestishJson<T>(output: string) {
  const jsonCandidates = parseJsonObjects(output)
  const lastJson = jsonCandidates.at(-1)
  if (!lastJson) {
    throw new Error(`Expected restish output to include JSON:\n${output}`)
  }
  return JSON.parse(lastJson) as T
}

function parseJsonObjects(output: string) {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start !== -1) {
        candidates.push(output.slice(start, index + 1))
        start = -1
      }
    }
  }

  return candidates
}

const EXPECTED_CORE_COMMANDS = [
  'create-agent',
  'create-environment',
  'create-session',
  'get-health',
  'list-agents',
  'list-environments',
  'list-sessions',
] as const

function operationIdToCommand(operationId: string) {
  return operationId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function discoverApiCommands(help: string) {
  const lines = help.split(/\r?\n/)
  const commands = new Set<string>()
  let inCommandSection = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^[A-Z][A-Za-z ]+ Commands:$/.test(trimmed)) {
      inCommandSection = true
      continue
    }
    if (!inCommandSection) continue
    if (trimmed === 'Flags:' || trimmed === 'Global Flags:') {
      break
    }
    const match = trimmed.match(/^([a-z][a-z0-9-]+)\s+/)
    if (match?.[1]) {
      commands.add(match[1])
    }
  }

  return [...commands].sort()
}

async function verifyDocumentedRestishCommands(home: string, documentedCommands: string[]) {
  const commands: string[] = []
  const missingCommands: string[] = []

  for (const command of documentedCommands) {
    const result = await runRestishRaw(home, ['ama', command, '--help'])
    if (result.status === 0) {
      commands.push(command)
    } else {
      missingCommands.push(command)
    }
  }

  return { commands, missingCommands }
}

function checkRestish() {
  const result = spawnSync('restish', ['--version'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error('restish is required for this e2e check')
  }
}

export async function createRestishOpenApiHarness(): Promise<RestishOpenApiHarness> {
  checkRestish()

  const app = createApp()
  const home = await mkdtemp(path.join(tmpdir(), 'ama-restish-home-'))
  const env = {
    AMA_DEFAULT_MODEL: '@cf/moonshotai/kimi-k2.6',
    AMA_RUNTIME_MODE: 'test',
    AMA_ALLOWED_ORIGINS: 'http://127.0.0.1',
    OIDC_ISSUER: 'https://oidc.example.test/api/auth',
    OIDC_CLIENT_ID: 'ama-restish-e2e',
  } as Env

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/api/openapi.json/') {
        url.pathname = '/api/openapi.json'
      }
      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = []
              request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
              request.on('end', () => resolve(Buffer.concat(chunks)))
              request.on('error', reject)
            })
      const requestInit: RequestInit = {
        method: request.method ?? 'GET',
        headers: request.headers as HeadersInit,
      }
      if (body !== undefined) {
        requestInit.body = body.toString('utf8')
      }
      const apiResponse = await app.fetch(new Request(url, requestInit), env)
      response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()))
      response.end(Buffer.from(await apiResponse.arrayBuffer()))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { type: 'internal_error', message: error instanceof Error ? error.message : String(error) },
        }),
      )
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to start restish e2e server')
  }
  const origin = `http://127.0.0.1:${address.port}`

  const restishConfigDir = configDir(home)
  await mkdir(restishConfigDir, { recursive: true })
  await writeFile(
    path.join(restishConfigDir, 'apis.json'),
    JSON.stringify({
      $schema: 'https://rest.sh/schemas/apis.json',
      ama: {
        base: `${origin}/api/openapi.json`,
        profiles: {
          default: {
            headers: {},
          },
        },
      },
    }),
  )

  return {
    origin,
    async discover() {
      const help = await runRestish(home, ['ama', '--help'])
      const openApi = (await fetch(`${origin}/api/openapi.json`).then((response) => response.json())) as {
        paths?: Record<string, Record<string, { operationId?: string }>>
      }
      const documentedCommands = Object.values(openApi.paths ?? {})
        .flatMap((methods) => Object.values(methods))
        .map((operation) => operation.operationId)
        .filter((operationId): operationId is string => Boolean(operationId))
        .map(operationIdToCommand)
        .sort()
      const expectedCommands = [...EXPECTED_CORE_COMMANDS].sort()
      const missingFromOpenApi = expectedCommands.filter((command) => !documentedCommands.includes(command))
      if (missingFromOpenApi.length > 0) {
        throw new Error(`OpenAPI is missing core restish operations: ${missingFromOpenApi.join(', ')}`)
      }
      const parsedCommands = discoverApiCommands(help)
      if (parsedCommands.length === 0) {
        throw new Error(`Restish did not expose any commands in generated help output:\n${help}`)
      }
      const verified = await verifyDocumentedRestishCommands(home, documentedCommands)
      const commands = verified.commands
      const missingCommands = verified.missingCommands
      const undocumentedCommands = parsedCommands.filter((command) => !documentedCommands.includes(command))
      const health = parseRestishJson<{ name: string }>(
        await runRestish(home, ['ama', 'get-health', '--rsh-output-format', 'json']),
      )
      return {
        commands,
        expectedCommands,
        missingCommands,
        documentedCommands,
        undocumentedCommands,
        healthName: health.name,
      }
    },
    async readJsonOutput() {
      const health = parseRestishJson<{ name: string }>(
        await runRestish(home, ['ama', 'get-health', '--rsh-output-format', 'json']),
      )
      const denied = await runRestishRaw(home, ['ama', 'create-agent', '--rsh-output-format', 'json'], {
        name: 'Restish JSON output agent',
        instructions: 'Verify machine readable errors.',
      })
      return {
        healthName: health.name,
        errorType: parseRestishError(denied),
      }
    },
    async createResourceWorkflow() {
      const environment = await runRestishRaw(home, ['ama', 'create-environment', '--rsh-output-format', 'json'], {
        name: 'Restish e2e environment',
        packages: [{ name: 'tsx', version: 'latest' }],
      })
      const agent = await runRestishRaw(home, ['ama', 'create-agent', '--rsh-output-format', 'json'], {
        name: 'Restish e2e agent',
        instructions: 'Run e2e checks through documented control-plane operations.',
      })
      const session = await runRestishRaw(home, ['ama', 'create-session', '--rsh-output-format', 'json'], {
        agentId: 'agent_restish_contract',
        environmentId: 'env_restish_contract',
        runtime: 'ama',
      })

      return {
        environmentErrorType: parseRestishError(environment),
        agentErrorType: parseRestishError(agent),
        sessionErrorType: parseRestishError(session),
      }
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(home, { recursive: true, force: true })
    },
  }
}
