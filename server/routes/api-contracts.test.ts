import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { Env } from '../env'

const routeSources = {
  agents: readFileSync('server/routes/agents.ts', 'utf8'),
  environments: readFileSync('server/routes/environments.ts', 'utf8'),
  sessions: readFileSync('server/routes/sessions.ts', 'utf8'),
}

async function openApiDoc() {
  const response = await createApp().fetch(new Request('https://example.test/api/openapi.json'), {} as Env)
  assert.equal(response.status, 200)
  return (await response.json()) as {
    components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> }
  }
}

function bodyFields(source: string) {
  const propertyAccess = [...source.matchAll(/\bbody\.([A-Za-z]\w*)/g)].map((match) => match[1])
  const destructured = [...source.matchAll(/const \{([^}]+)\} = c\.req\.valid\('json'\)/g)].flatMap((match) =>
    match[1]!
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean),
  )
  return [...propertyAccess, ...destructured].sort()
}

function schemaFields(doc: Awaited<ReturnType<typeof openApiDoc>>, schemaName: string) {
  return Object.keys(doc.components?.schemas?.[schemaName]?.properties ?? {}).sort()
}

describe('route schema and handler alignment', () => {
  it('keeps agent write fields aligned across handlers and OpenAPI schemas', async () => {
    const doc = await openApiDoc()
    const handled = [...new Set(bodyFields(routeSources.agents))]
    const createFields = schemaFields(doc, 'CreateAgentRequest')
    const updateFields = schemaFields(doc, 'UpdateAgentRequest')

    expect(handled).toEqual(createFields)
    expect(updateFields).toEqual(createFields)
  })

  it('keeps environment write fields aligned across handlers and OpenAPI schemas', async () => {
    const doc = await openApiDoc()
    const handled = [...new Set(bodyFields(routeSources.environments))]
    const createFields = schemaFields(doc, 'CreateEnvironmentRequest')
    const updateFields = schemaFields(doc, 'UpdateEnvironmentRequest')

    expect(handled).toEqual(createFields)
    expect(updateFields).toEqual(createFields)
  })

  it('keeps session write fields aligned across handlers and OpenAPI schemas', async () => {
    const doc = await openApiDoc()

    expect([...new Set(bodyFields(routeSources.sessions))]).toEqual(['agentId', 'status'])
    expect(schemaFields(doc, 'CreateSessionRequest')).toEqual(['agentId'])
    expect(schemaFields(doc, 'UpdateSessionRequest')).toEqual(['status'])
  })
})
