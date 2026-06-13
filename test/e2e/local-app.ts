import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { type APIRequestContext, type Browser, chromium, type Page } from '@playwright/test'

let devServer: ChildProcessWithoutNullStreams | undefined
let devServerOutput = ''
let browser: Browser | undefined
let baseURL: string | undefined
let ownsDevServer = false

export async function openLocalPage() {
  const origin = await ensureLocalApp()
  browser ??= await chromium.launch({ headless: true })
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
  })
  return await context.newPage()
}

export async function authenticateE2EPage(page: Page) {
  const runId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const response = await requestWithLocalAppRecovery(page, () =>
    page.request.post('/api/v1/e2e/auth/token', { data: { runId } }),
  )
  if (!response.ok()) {
    throw new Error(`POST /api/v1/e2e/auth/token returned ${response.status()}: ${await response.text()}`)
  }
  const { accessToken, userId, organizationId, projectId } = (await response.json()) as {
    accessToken: string
    userId: string
    organizationId: string
    projectId: string
  }
  await page.context().setExtraHTTPHeaders({ authorization: `Bearer ${accessToken}` })
  await page.addInitScript((token) => window.localStorage.setItem('ama:e2e-access-token', token), accessToken)
  await page.addInitScript((id) => window.localStorage.setItem('ama:selected-project-id', id), projectId)
  if (page.url() === 'about:blank') {
    await page.goto('/')
  }
  // The app may issue a client-side redirect right after load; a navigation
  // mid-evaluate destroys the execution context, so retry once on a settled page.
  const seedLocalStorage = () =>
    page.evaluate(
      ([token, id]) => {
        window.localStorage.setItem('ama:e2e-access-token', token)
        window.localStorage.setItem('ama:selected-project-id', id)
      },
      [accessToken, projectId] as [string, string],
    )
  try {
    await seedLocalStorage()
  } catch {
    await page.waitForLoadState('load')
    await seedLocalStorage()
  }
  const tokenRunId = accessToken.startsWith('e2e:')
    ? accessToken.slice('e2e:'.length)
    : userId.replace(/^user_e2e_/, '')
  return {
    user: { id: userId, email: `${tokenRunId}@e2e.example.com`, name: `E2E User ${tokenRunId}`, avatarUrl: null },
    organization: { id: organizationId, name: organizationId },
    project: { id: projectId, name: 'Default project' },
    roles: ['owner'],
    permissions: ['*'],
  }
}

export async function ensureLocalApp() {
  if (baseURL && (await isE2EReady(baseURL))) {
    return baseURL
  }
  if (process.env.E2E_BASE_URL) {
    baseURL = process.env.E2E_BASE_URL
    return baseURL
  }
  if (baseURL) {
    baseURL = undefined
    await stopDevServer()
  }

  process.env.CLOUDFLARE_ENV = process.env.CLOUDFLARE_ENV ?? 'e2e'
  process.env.AMA_E2E_TEST_AUTH = 'true'
  process.env.AMA_RUNTIME_MODE = 'test'

  // Each run gets its own ephemeral port unless E2E_APP_PORT pins one explicitly.
  // Reusing a fixed port silently attaches the suite to whatever e2e server is
  // already listening there — including one serving a different worktree's code.
  const explicitPort = process.env.E2E_APP_PORT
  const port = explicitPort ? Number(explicitPort) : await findFreePort()
  process.env.E2E_APP_PORT = String(port)

  const origin = `http://localhost:${port}`
  if (await isHttpReady(origin)) {
    if (explicitPort && (await isE2EReady(origin))) {
      baseURL = origin
      ownsDevServer = false
      return baseURL
    }
    throw new Error(`Port ${port} is already in use by a server this run does not own.`)
  }

  devServerOutput = ''
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ENV: process.env.CLOUDFLARE_ENV,
    AMA_E2E_TEST_AUTH: process.env.AMA_E2E_TEST_AUTH,
    AMA_RUNTIME_MODE: process.env.AMA_RUNTIME_MODE,
    E2E_APP_PORT: String(port),
  }
  delete childEnv.NODE_OPTIONS
  devServer = spawn('npx', ['vite', 'dev', '--host', 'localhost'], {
    cwd: process.cwd(),
    env: childEnv,
    detached: true,
    stdio: 'pipe',
  })
  ownsDevServer = true
  devServer.stdout.on('data', (chunk) => {
    devServerOutput += String(chunk)
  })
  devServer.stderr.on('data', (chunk) => {
    devServerOutput += String(chunk)
  })
  baseURL = origin
  await waitForDevServer(baseURL)
  return baseURL
}

export async function closeLocalApp() {
  await closeBrowser()
  browser = undefined
  await stopDevServer()
  baseURL = undefined
}

export async function apiJson<T>(
  request: APIRequestContext,
  path: string,
  init: NonNullable<Parameters<APIRequestContext['fetch']>[1]> = {},
) {
  const response = await request.fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  })
  const text = await response.text()
  if (!response.ok()) {
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status()}: ${text}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

async function stopDevServer() {
  if (!devServer) {
    ownsDevServer = false
    return
  }
  const server = devServer
  devServer = undefined
  ownsDevServer = false
  const exited = new Promise<void>((resolve) => {
    server.once('exit', () => resolve())
  })
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      server.kill('SIGTERM')
    }
  } else {
    server.kill('SIGTERM')
  }
  const didExit = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])
  if (!didExit && server.pid) {
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      server.kill('SIGKILL')
    }
    await Promise.race([exited, delay(5_000)])
  }
}

async function requestWithLocalAppRecovery<T>(page: Page, request: () => Promise<T>) {
  try {
    return await request()
  } catch (error) {
    if (!ownsDevServer || !(await isLocalConnectionFailure(error))) {
      throw error
    }
    await stopDevServer()
    baseURL = undefined
    const origin = await ensureLocalApp()
    await page.goto(origin)
    return await request()
  }
}

async function isLocalConnectionFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /ECONNRESET|ECONNREFUSED|socket hang up|Target page, context or browser has been closed/i.test(message)
}

async function closeBrowser() {
  if (!browser) {
    return
  }
  await Promise.race([browser.close(), delay(5_000)])
}

async function waitForDevServer(origin: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (devServer?.exitCode !== null) {
      throw new Error(`Local e2e dev server exited with code ${devServer?.exitCode}:\n${devServerOutput}`)
    }
    if ((await isHttpReady(origin)) && (await isE2EReady(origin))) {
      return
    }
    await delay(1_000)
  }
  throw new Error(`Local e2e dev server did not become ready:\n${devServerOutput}`)
}

async function findFreePort() {
  const { createServer } = await import('node:net')
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate a free e2e port')))
        return
      }
      probe.close(() => resolve(address.port))
    })
  })
}

async function isHttpReady(origin: string) {
  try {
    const response = await fetch(`${origin}/api/v1/health`)
    return response.ok
  } catch {
    return false
  }
}

async function isE2EReady(origin: string) {
  try {
    const response = await fetch(`${origin}/api/v1/e2e/ready`)
    return response.ok
  } catch {
    return false
  }
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
