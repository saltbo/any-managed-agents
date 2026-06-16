import { Hono } from 'hono'
import { aiGatewayFor } from '../adapters/runtime/workers-ai-model-client'
import type { Env } from '../env'
import { errorResponse } from '../errors'

const app = new Hono<{ Bindings: Env }>()

function bearerToken(header: string | null) {
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

const routes = app.post('/workers-ai/v1/chat/completions', async (c) => {
  const expectedToken = c.env.AMA_RUNTIME_AI_PROXY_TOKEN
  if (!expectedToken) {
    return errorResponse(c, 500, 'internal_error', 'Runtime Workers AI proxy token is not configured')
  }
  if (bearerToken(c.req.header('authorization') ?? null) !== expectedToken) {
    return errorResponse(c, 401, 'authentication_required', 'Runtime Workers AI proxy authentication failed')
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  const model = typeof body?.model === 'string' ? body.model : null
  if (!body || !model) {
    return errorResponse(c, 400, 'validation_error', 'OpenAI chat completion body must include model')
  }

  const gateway = aiGatewayFor(c.env, model)
  const response = await c.env.AI.run(model, body, { returnRawResponse: true, ...(gateway ? { gateway } : {}) })
  // Workers AI types the binding return as Record<string, unknown>, but the
  // returnRawResponse overload yields a real Response at runtime. This is an
  // external-protocol adapter endpoint (design §1.8), not the AMA contract.
  const rawResponse = response as unknown as Response
  const headers = new Headers(rawResponse.headers)
  headers.set('cache-control', 'no-store')
  return new Response(rawResponse.body, {
    status: rawResponse.status,
    headers,
  })
})

export default routes
