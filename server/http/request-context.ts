import type { Context, Env as HonoEnv } from 'hono'
import type { Env } from '../env'

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

// Pure http helper: derives the request correlation id from inbound headers,
// minting one when absent. Generic over the caller's Hono env so routes with or
// without extra context Variables (e.g. injected Deps) can call it — context
// Variables are invariant, so a fixed param would reject one shape.
export function requestId<E extends HonoEnv>(c: Context<E & { Bindings: Env }>) {
  return c.req.header('x-request-id') ?? c.req.header('cf-ray') ?? newId('req')
}
