import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1])
}

const port = Number(args.get('--port') ?? process.env.AMA_PI_BRIDGE_PORT ?? 8788)
const sessionId = args.get('--session-id') ?? process.env.AMA_SESSION_ID
const provider = args.get('--provider') ?? process.env.PI_PROVIDER
const model = args.get('--model') ?? process.env.PI_MODEL
const events = []
const clients = new Set()

const piArgs = ['--mode', 'rpc', '--session-dir', '/workspace/.pi-sessions']
if (provider) {
  piArgs.push('--provider', provider)
}
if (model) {
  piArgs.push('--model', model)
}

const pi = spawn('pi', piArgs, {
  cwd: '/workspace',
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
})

function publish(line) {
  events.push(line)
  while (events.length > 1000) {
    events.shift()
  }
  for (const client of clients) {
    client.write(line.endsWith('\n') ? line : `${line}\n`)
  }
}

pi.stdout.on('data', (chunk) => publish(chunk.toString('utf8')))
pi.stderr.on('data', (chunk) => publish(JSON.stringify({ type: 'bridge_stderr', data: chunk.toString('utf8') })))
pi.on('exit', (code, signal) => publish(JSON.stringify({ type: 'bridge_exit', code, signal })))

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  if (url.pathname === '/health') {
    response.writeHead(pi.exitCode === null ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: pi.exitCode === null, sessionId }))
    return
  }

  if (url.pathname === '/rpc' && request.method === 'POST') {
    const eventCursor = events.length
    request.on('data', (chunk) => pi.stdin.write(chunk))
    request.on('end', () => {
      if (!pi.stdin.destroyed) {
        pi.stdin.write('\n')
      }
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ accepted: true, eventCursor }))
    })
    return
  }

  if (url.pathname === '/rpc' && request.method === 'GET') {
    response.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    const rawCursor = url.searchParams.get('cursor')
    const cursor = Number(rawCursor ?? 0)
    const replayFrom =
      rawCursor === 'latest' ? events.length : Number.isFinite(cursor) && cursor > 0 ? Math.min(cursor, events.length) : 0
    for (const event of events.slice(replayFrom)) {
      response.write(event.endsWith('\n') ? event : `${event}\n`)
    }
    clients.add(response)
    request.on('close', () => clients.delete(response))
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'not_found' }))
}).listen(port)
