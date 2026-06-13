import type { SessionEventPort } from '@server/usecases/ports'
import { eq, max } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { sessionEvents } from '../../db/schema'
import { redactSensitiveValue } from '../../redaction'

type Db = ReturnType<typeof drizzle>

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

// Canonical session-event append with the same sequence-collision retry the
// runtime event paths use; MCP policy checks, calls, and results stay
// inspectable on the session after completion.
export function createSessionEventPort(db: Db): SessionEventPort {
  return {
    async append(values) {
      const auth = values.auth
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const eventId = newId('event')
        const latest = await db
          .select({ sequence: max(sessionEvents.sequence) })
          .from(sessionEvents)
          .where(eq(sessionEvents.sessionId, values.sessionId))
          .get()
        try {
          await db.insert(sessionEvents).values({
            id: eventId,
            organizationId: auth.organization.id,
            projectId: auth.project.id,
            sessionId: values.sessionId,
            sequence: (latest?.sequence ?? 0) + 1,
            type: values.type,
            visibility: 'runtime',
            role: null,
            parentEventId: values.parentEventId ?? null,
            correlationId: values.correlationId ?? null,
            payload: stringify(redactSensitiveValue(values.payload)),
            metadata: stringify({ source: 'mcp-client' }),
            createdAt: new Date().toISOString(),
          })
          return eventId
        } catch (error) {
          if (attempt === 4 || !String(error).includes('UNIQUE')) {
            throw error
          }
        }
      }
      /* v8 ignore start -- reason: unreachable; the for-loop always returns or throws before exhausting 5 iterations */
      throw new Error('Unable to append MCP session event')
      /* v8 ignore stop */
    },
  }
}
