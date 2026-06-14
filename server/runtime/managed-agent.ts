import { Agent } from 'agents'
import type { Env } from '../env'

interface ManagedAgentState {
  status: 'idle' | 'running' | 'error'
  lastPrompt?: string
  lastResponse?: string
  updatedAt?: string
}

export class ManagedAgent extends Agent<Env, ManagedAgentState> {
  override initialState: ManagedAgentState = {
    status: 'idle',
  }

  override async onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  }

  override async onRequest(request: Request) {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname.endsWith('/state')) {
      return Response.json({ state: this.state })
    }

    if (request.method === 'GET' && url.pathname.endsWith('/messages')) {
      const rows = this.sql`
        SELECT id, role, content, created_at
        FROM messages
        ORDER BY created_at ASC
      `
      return Response.json({ data: rows })
    }

    if (request.method === 'POST' && url.pathname.endsWith('/run')) {
      const body = (await request.json().catch(() => ({}))) as { prompt?: string; model?: string }
      const prompt = body.prompt?.trim()
      if (!prompt) {
        return Response.json({ error: { type: 'validation_error', message: 'prompt is required' } }, { status: 400 })
      }

      const createdAt = new Date().toISOString()
      this.sql`
        INSERT INTO messages (id, role, content, created_at)
        VALUES (${crypto.randomUUID()}, ${'user'}, ${prompt}, ${createdAt})
      `
      this.setState({ status: 'running', lastPrompt: prompt, updatedAt: createdAt })

      try {
        const model = body.model ?? this.env.AMA_DEFAULT_MODEL ?? '@cf/moonshotai/kimi-k2.6'
        const result = (await this.env.AI.run(model, { prompt })) as {
          response?: string
          text?: string
        }
        const response = result.response ?? result.text ?? JSON.stringify(result)
        const responseAt = new Date().toISOString()

        this.sql`
          INSERT INTO messages (id, role, content, created_at)
          VALUES (${crypto.randomUUID()}, ${'assistant'}, ${response}, ${responseAt})
        `
        this.setState({
          status: 'idle',
          lastPrompt: prompt,
          lastResponse: response,
          updatedAt: responseAt,
        })

        return Response.json({ model, response })
      } catch (error) {
        this.setState({ status: 'error', lastPrompt: prompt, updatedAt: new Date().toISOString() })
        return Response.json(
          {
            error: {
              type: 'model_error',
              message: error instanceof Error ? error.message : 'Model request failed',
            },
          },
          { status: 502 },
        )
      }
    }

    return Response.json({ error: { type: 'not_found', message: 'ManagedAgent route not found' } }, { status: 404 })
  }
}
