import type { OpenAPIHono } from '@hono/zod-openapi'
import type { DepsEnv } from '../openapi'
import { handleRuntimeProxyRequest } from '../runtime/runtime-proxy'

// Registers the /api/v1/runtime data-plane proxy. The proxy is a non-REST
// protocol-adapter surface (ACP tunnel, OpenAI-compatible inference, WebSocket
// RPC), exempt from REST resource modeling (docs/api-v1-design.md §1.8). The
// http layer only wires the catch-all route; the env-bound handler lives in
// server/runtime/runtime-proxy.ts so this layer stays drizzle-free.
//
// Registration position is load-bearing: the assembler in app.ts mounts this
// after the typed /api/v1/runtime sub-router so the catch-all only matches the
// session protocol paths.
export function registerRuntimeProxy(routes: OpenAPIHono<DepsEnv>) {
  routes.all('/api/v1/runtime/sessions/:sessionId/*', (c) => handleRuntimeProxyRequest(c))
  return routes
}
