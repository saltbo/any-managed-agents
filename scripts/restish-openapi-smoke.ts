import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createApp } from '../server/app'
import type { Env } from '../server/env'

function configDir(home: string) {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'restish')
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'restish')
  }
  return path.join(home, '.config', 'restish')
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function runRestish(home: string, args: string[], input?: unknown) {
  return new Promise<string>((resolve, reject) => {
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
      if (code !== 0) {
        reject(
          new Error(
            [
              `restish ${args.join(' ')} failed with status ${code}`,
              Buffer.concat(stdout).toString('utf8'),
              Buffer.concat(stderr).toString('utf8'),
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        )
        return
      }
      resolve(Buffer.concat(stdout).toString('utf8'))
    })
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input))
  })
}

function checkRestish() {
  const result = spawnSync('restish', ['--version'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error('restish is required for this smoke test')
  }
}

async function main() {
  checkRestish()

  const app = createApp()
  const openApiResponse = await app.fetch(new Request('https://example.com/api/openapi.json'), {} as Env)
  const openApi = await openApiResponse.text()
  const home = await mkdtemp(path.join(tmpdir(), 'ama-restish-home-'))

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    let result = jsonResponse({ error: { type: 'not_found', message: 'Not found' } }, 404)

    if (request.method === 'GET' && (url.pathname === '/api/openapi.json' || url.pathname === '/api/openapi.json/')) {
      result = { status: 200, headers: { 'content-type': 'application/json' }, body: openApi }
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      result = jsonResponse({
        status: 'ok',
        name: 'Any Managed Agents',
        runtime: 'cloudflare-workers',
        timestamp: new Date().toISOString(),
      })
    }
    if (request.method === 'POST' && url.pathname === '/api/environments') {
      const body = JSON.parse(await readBody(request)) as { name: string }
      result = jsonResponse(
        {
          id: 'env_restish_smoke',
          projectId: 'project_restish_smoke',
          name: body.name,
          currentVersionId: 'envver_restish_smoke',
          version: 1,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        201,
      )
    }
    if (request.method === 'POST' && url.pathname === '/api/agents') {
      const body = JSON.parse(await readBody(request)) as { name: string }
      result = jsonResponse(
        {
          id: 'agent_restish_smoke',
          projectId: 'project_restish_smoke',
          name: body.name,
          currentVersionId: 'agentver_restish_smoke',
          version: 1,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        201,
      )
    }
    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      const body = JSON.parse(await readBody(request)) as { agentId: string }
      result = jsonResponse(
        {
          id: 'session_restish_smoke',
          agentId: body.agentId,
          agentVersionId: 'agentver_restish_smoke',
          environmentId: 'env_restish_smoke',
          environmentVersionId: 'envver_restish_smoke',
          runtimeEndpointPath: '/runtime/sessions/session_restish_smoke/rpc',
          status: 'idle',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        201,
      )
    }

    response.writeHead(result.status, result.headers)
    response.end(result.body)
  })

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Unable to start restish smoke server')
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
              headers: { cookie: '__Host-ama_session=restish-smoke' },
            },
          },
        },
      }),
    )

    const help = await runRestish(home, ['ama', '--help'])
    for (const command of ['get-health', 'create-environment', 'create-agent', 'create-session']) {
      if (!help.includes(command)) {
        throw new Error(`restish did not discover ${command}`)
      }
    }

    const health = JSON.parse(await runRestish(home, ['ama', 'get-health', '--rsh-output-format', 'json'])) as {
      name: string
    }
    if (health.name !== 'Any Managed Agents') {
      throw new Error('restish health smoke returned the wrong product identity')
    }

    const environment = JSON.parse(
      await runRestish(
        home,
        ['ama', 'create-environment', '--rsh-output-format', 'json'],
        {
          name: 'Restish smoke environment',
          packages: [{ name: 'tsx', version: 'latest' }],
        },
      ),
    ) as { id: string }

    const agent = JSON.parse(
      await runRestish(
        home,
        ['ama', 'create-agent', '--rsh-output-format', 'json'],
        {
          name: 'Restish smoke agent',
          instructions: 'Run smoke checks through documented control-plane operations.',
        },
      ),
    ) as { id: string }

    const session = JSON.parse(
      await runRestish(home, ['ama', 'create-session', '--rsh-output-format', 'json'], {
        agentId: agent.id,
        environmentId: environment.id,
      }),
    ) as { runtimeEndpointPath: string; status: string }

    if (session.status !== 'idle' || session.runtimeEndpointPath !== '/runtime/sessions/session_restish_smoke/rpc') {
      throw new Error('restish session smoke returned an invalid session response')
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(home, { recursive: true, force: true })
  }
}

await main()
