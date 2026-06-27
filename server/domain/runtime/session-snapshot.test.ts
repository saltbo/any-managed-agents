import { describe, expect, it } from 'vitest'
import {
  agentSnapshotWithMemoryStoreContext,
  normalizeResourceRefs,
  type SerializedAgentVersion,
} from './session-snapshot'

function agentSnapshot(overrides: Partial<SerializedAgentVersion> = {}): SerializedAgentVersion {
  return {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    instructions: 'Base instructions.',
    providerId: 'workers-ai',
    model: '@cf/test/model',
    skills: [],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: {},
    tools: [],
    mcpConnectors: [],
    metadata: {},
    createdAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
  }
}

describe('[spec: sessions/memory-store-resources] memory store resource refs', () => {
  it('accepts managed memory store refs and rejects caller-provided mount paths', () => {
    expect(
      normalizeResourceRefs([{ type: 'memory_store', storeId: 'memstore_1', access: 'read_only' }]).resourceRefs,
    ).toEqual([{ type: 'memory_store', storeId: 'memstore_1', access: 'read_only' }])

    expect(
      normalizeResourceRefs([
        { type: 'memory_store', storeId: 'memstore_1', access: 'read_only', mountPath: '/workspace/custom' },
      ]),
    ).toEqual({ fields: { 'resourceRefs.0.mountPath': 'Memory store mount paths are managed by AMA.' } })
  })

  it('requires access and unique store ids per session', () => {
    expect(normalizeResourceRefs([{ type: 'memory_store', storeId: 'memstore_1', access: 'writer' }])).toEqual({
      fields: { 'resourceRefs.0.access': 'Use read_only or read_write.' },
    })
    expect(
      normalizeResourceRefs([
        { type: 'memory_store', storeId: 'memstore_1', access: 'read_only' },
        { type: 'memory_store', storeId: 'memstore_1', access: 'read_write' },
      ]),
    ).toEqual({ fields: { 'resourceRefs.1.storeId': 'Memory store must be unique within a session.' } })
  })

  it('adds store metadata to the runtime system prompt without memory contents', () => {
    const augmented = agentSnapshotWithMemoryStoreContext(agentSnapshot(), [
      {
        type: 'github_repository',
        owner: 'saltbo',
        repo: 'agent-kanban',
        ref: 'main',
        mountPath: '/workspace/repos/saltbo/agent-kanban',
      },
      {
        type: 'memory_store',
        storeId: 'memstore_1',
        name: 'Team memory',
        description: 'Review conventions.',
        access: 'read_write',
        mountPath: '/workspace/.ama/memory-stores/memstore_1',
        memories: [{ path: 'guide.md', content: 'secret memory content' }],
      },
    ])
    expect(augmented.instructions).toContain('Base instructions.')
    expect(augmented.instructions).toContain('Workspace layout:')
    expect(augmented.instructions).toContain('saltbo/agent-kanban at repos/saltbo/agent-kanban')
    expect(augmented.instructions).toContain('Team memory')
    expect(augmented.instructions).toContain('Review conventions.')
    expect(augmented.instructions).toContain('.ama/memory-stores/memstore_1')
    expect(augmented.instructions).not.toContain('secret memory content')
  })
})
