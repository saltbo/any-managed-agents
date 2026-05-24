import { execFileSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'

const encoder = new TextEncoder()
const baseUrl = process.env.AMA_E2E_BASE_URL ?? 'http://127.0.0.1:5173'
const expectModelSuccess = process.env.AMA_E2E_EXPECT_MODEL_SUCCESS === 'true'
const localSessionSecret =
  process.env.AMA_SESSION_SECRET ?? 'local-development-session-secret-change-before-shared-use'

interface Session {
  id: string
  status: string
  statusReason: string | null
  runtimeEndpointPath: string
  piRuntimeId: string | null
}

interface ListResponse<T> {
  data: T[]
}

interface SessionEvent {
  type: string
  visibility: string
  role: string | null
  payload: Record<string, unknown>
}

const cookie = await authCookie()

await assertJson('/api/auth/me')
const environment = await assertJson<{ id: string; status: string }>('/api/environments', {
  method: 'POST',
  body: JSON.stringify({
    name: `Real E2E Env ${Date.now()}`,
    packages: [{ name: '@earendil-works/pi-coding-agent', version: 'prebuilt' }],
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
    runtimeImage: { image: 'ama-pi-runtime' },
  }),
})
const agent = await assertJson<{ id: string; status: string }>('/api/agents', {
  method: 'POST',
  body: JSON.stringify({
    name: `Real E2E Agent ${Date.now()}`,
    instructions: 'Reply briefly. Do not write files unless explicitly requested.',
    allowedTools: ['sandbox.exec'],
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
  }),
})

const createdAt = Date.now()
const created = await assertJson<Session>('/api/sessions', {
  method: 'POST',
  body: JSON.stringify({
    agentId: agent.id,
    environmentId: environment.id,
    title: 'Real E2E session',
  }),
})
const session = await waitForUsableSession(created)
const runtimeEvents = await sendRuntimeMessage(session, 'Say AMA real e2e ok.')
const events = await assertJson<ListResponse<SessionEvent>>(`/api/sessions/${session.id}/events`)
const stopped = await assertJson<Session>(`/api/sessions/${session.id}/stop`, { method: 'POST', body: '{}' })

const runtimeLog = events.data.filter((event) => event.visibility === 'runtime')
const assistantMessages = runtimeLog.filter((event) => {
  const message = objectValue(event.payload.message)
  return (
    (event.type === 'message_update' || event.type === 'message_end' || event.type === 'agent_end') &&
    message.role === 'assistant' &&
    Boolean(message.content ?? event.payload.content)
  )
})
const runtimeErrors = runtimeLog.filter((event) => event.type === 'error' || event.type === 'bridge_stderr')
const rawJsonTranscript = assistantMessages.some((event) => {
  const message = objectValue(event.payload.message)
  const content = String(message.content ?? event.payload.content ?? '')
  return content.trim().startsWith('{') && content.includes('"type"')
})

if (rawJsonTranscript) {
  throw new Error('Runtime emitted raw JSON into the transcript')
}
if (expectModelSuccess && (assistantMessages.length === 0 || runtimeErrors.length > 0)) {
  throw new Error('Expected a successful model response, but the runtime only produced an error')
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      environment: { id: environment.id, status: environment.status },
      agent: { id: agent.id, status: agent.status },
      session: {
        id: session.id,
        initialStatus: created.status,
        finalStatus: session.status,
        stoppedStatus: stopped.status,
        runtimeEndpointPath: session.runtimeEndpointPath,
        piRuntimeId: session.piRuntimeId,
        startupMs: Date.now() - createdAt,
      },
      runtimeEvents,
      persistedRuntimeEvents: runtimeLog.map((event) => event.type),
      assistantMessages: assistantMessages.length,
      runtimeErrors: runtimeErrors.length,
      modelSuccess: assistantMessages.length > 0 && runtimeErrors.length === 0,
    },
    null,
    2,
  ),
)

async function authCookie() {
  if (process.env.AMA_E2E_COOKIE) {
    return process.env.AMA_E2E_COOKIE
  }
  const url = new URL(baseUrl)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Set AMA_E2E_COOKIE when running real E2E against a non-local deployment')
  }
  return await seedLocalAuth()
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function seedLocalAuth() {
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
  const suffix = Date.now()
  const userId = `user_e2e_${suffix}`
  const orgId = `org_e2e_${suffix}`
  const projectId = `project_e2e_${suffix}`
  const membershipId = `membership_e2e_${suffix}`
  const authSessionId = `auth_session_e2e_${suffix}`
  const token = base64Url(webcrypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await hmac(localSessionSecret, token)
  const sessionToken = `${authSessionId}.${token}`
  const signedSessionToken = `${sessionToken}.${await hmac(localSessionSecret, sessionToken)}`
  const roles = JSON.stringify(['owner'])
  const permissions = JSON.stringify(['agents:write', 'agents:read'])

  d1(
    `INSERT INTO users (id, flareauth_subject, email, name, avatar_url, created_at, updated_at) VALUES ('${userId}', '${userId}', '${userId}@example.com', 'E2E User', NULL, '${now}', '${now}')`,
  )
  d1(
    `INSERT INTO organizations (id, flareauth_organization_id, name, created_at, updated_at) VALUES ('${orgId}', '${orgId}', 'E2E Org', '${now}', '${now}')`,
  )
  d1(
    `INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES ('${projectId}', '${orgId}', 'E2E Project', '${now}', '${now}')`,
  )
  d1(
    `INSERT INTO memberships (id, user_id, organization_id, roles, permissions, created_at, updated_at) VALUES ('${membershipId}', '${userId}', '${orgId}', '${sqlEscape(roles)}', '${sqlEscape(permissions)}', '${now}', '${now}')`,
  )
  d1(
    `INSERT INTO app_sessions (id, token_hash, user_id, organization_id, project_id, expires_at, revoked_at, created_at) VALUES ('${authSessionId}', '${tokenHash}', '${userId}', '${orgId}', '${projectId}', '${expiresAt}', NULL, '${now}')`,
  )
  return `__Host-ama_session=${signedSessionToken}`
}

function d1(sql: string) {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'any-managed-agents-db-staging',
      '--local',
      '--env',
      'staging',
      '--command',
      sql,
    ],
    {
      cwd: process.cwd(),
      stdio: 'pipe',
    },
  )
}

async function assertJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie,
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  const body = text ? (JSON.parse(text) as T) : (null as T)
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${text}`)
  }
  return body
}

async function waitForUsableSession(created: Session) {
  let session = created
  for (let attempt = 0; attempt < 75; attempt += 1) {
    if (session.status === 'idle' || session.status === 'running') {
      return session
    }
    if (session.status === 'error') {
      throw new Error(`Session startup failed: ${session.statusReason ?? 'unknown error'}`)
    }
    await sleep(2000)
    session = await assertJson<Session>(`/api/sessions/${created.id}`)
  }
  throw new Error(`Session stayed ${session.status} after waiting for runtime startup`)
}

async function sendRuntimeMessage(session: Session, message: string) {
  const wsUrl = new URL(session.runtimeEndpointPath.replace(/\/rpc$/, '/ws'), baseUrl)
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(wsUrl, { headers: { cookie } } as unknown as string | string[])
  const events: string[] = []
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Runtime WebSocket timed out')), 90_000)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 'real-e2e-prompt', type: 'prompt', message }))
    })
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>
      const type = typeof payload.type === 'string' ? payload.type : 'message'
      events.push(type)
      if (
        type === 'agent_end' ||
        type === 'bridge_exit' ||
        type === 'error' ||
        (type === 'response' && payload.success === false)
      ) {
        clearTimeout(timeout)
        resolve()
      }
    })
    socket.addEventListener('error', () => reject(new Error('Runtime WebSocket failed')))
  })
  socket.close()
  return events
}

function sqlEscape(value: string) {
  return value.replaceAll("'", "''")
}

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function hmac(secret: string, value: string) {
  const key = await webcrypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return base64Url(new Uint8Array(await webcrypto.subtle.sign('HMAC', key, encoder.encode(value))))
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
