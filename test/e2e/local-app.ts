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
    page.request.post('/api/e2e/auth/token', { data: { runId } }),
  )
  if (!response.ok()) {
    throw new Error(`POST /api/e2e/auth/token returned ${response.status()}: ${await response.text()}`)
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
  await page.evaluate((token) => window.localStorage.setItem('ama:e2e-access-token', token), accessToken)
  await page.evaluate((id) => window.localStorage.setItem('ama:selected-project-id', id), projectId)
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
  process.env.E2E_APP_PORT = process.env.E2E_APP_PORT ?? '5173'

  const port = Number(process.env.E2E_APP_PORT)
  const origin = `http://localhost:${port}`
  if (await isHttpReady(origin)) {
    if (await isE2EReady(origin)) {
      baseURL = origin
      ownsDevServer = false
      return baseURL
    }
    throw new Error(`Port ${port} is already in use by a server that is not configured for local e2e auth.`)
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

export async function apiResponse(
  request: APIRequestContext,
  path: string,
  init: NonNullable<Parameters<APIRequestContext['fetch']>[1]> = {},
) {
  return await request.fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  })
}

export async function waitForSession(
  request: APIRequestContext,
  sessionId: string,
  expectedStatus: string | ((status: string) => boolean) = 'idle',
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await apiJson<{ id: string; status: string; statusReason: string | null }>(
      request,
      `/api/sessions/${sessionId}`,
    )
    const ok = typeof expectedStatus === 'function' ? expectedStatus(session.status) : session.status === expectedStatus
    if (ok) {
      return session
    }
    if (session.status === 'error') {
      throw new Error(`Session startup failed: ${session.statusReason ?? 'unknown error'}`)
    }
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not reach the expected status before timeout`)
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

async function isHttpReady(origin: string) {
  try {
    const response = await fetch(`${origin}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

async function isE2EReady(origin: string) {
  try {
    const response = await fetch(`${origin}/api/e2e/ready`)
    return response.ok
  } catch {
    return false
  }
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
