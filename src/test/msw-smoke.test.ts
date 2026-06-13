import { describe, expect, it } from 'vitest'
import { api } from '@/lib/api'
import { createCollection, resourceHandlers, server } from './msw'

// Foundation smoke: the REAL api client (not mocked) must reach MSW, send auth +
// project headers, and round-trip the {data, pagination} envelope + a create.
describe('web suite foundation (real api client + MSW)', () => {
  it('lists and creates agents through the real client against MSW', async () => {
    type Agent = { id: string; name: string }
    const agents = createCollection<Agent>([{ id: 'agent_1', name: 'Seeded' }])
    server.use(
      ...resourceHandlers<Agent>('agents', agents, (body, index) => ({
        id: `agent_${index + 2}`,
        name: String(body.name),
      })),
    )

    const page = await api.listAgents({})
    expect(page.data.map((a) => a.name)).toContain('Seeded')

    const created = await api.createAgent({ name: 'Created via MSW' })
    expect(created.id).toBeTruthy()

    const after = await api.listAgents({})
    expect(after.data.map((a) => a.name)).toContain('Created via MSW')
  })
})
