import { describe, expect, it } from 'vitest'
import {
  agentSnapshotWithWorkspaceContext,
  normalizeWorkspaceVolumes,
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

describe('[spec: sessions/memory-store-resources] memory store volumes', () => {
  it('accepts managed memory store volumes and rejects unsafe mounts', () => {
    expect(
      normalizeWorkspaceVolumes(
        [{ name: 'memory-memstore_1', type: 'memory_store', storeId: 'memstore_1', access: 'read_only' }],
        [{ name: 'memory-memstore_1', mountPath: '/workspace/.ama/memory-stores/memstore_1' }],
      ).volumes,
    ).toEqual([{ name: 'memory-memstore_1', type: 'memory_store', storeId: 'memstore_1', access: 'read_only' }])

    expect(
      normalizeWorkspaceVolumes(
        [{ name: 'memory-memstore_1', type: 'memory_store', storeId: 'memstore_1', access: 'read_only' }],
        [{ name: 'memory-memstore_1', mountPath: '/workspace/custom' }],
      ),
    ).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Memory store mounts must stay under /workspace/.ama/memory-stores.' },
    })
  })

  it('requires access and unique store ids per session', () => {
    expect(
      normalizeWorkspaceVolumes(
        [{ name: 'memory-memstore_1', type: 'memory_store', storeId: 'memstore_1', access: 'writer' as never }],
        [{ name: 'memory-memstore_1', mountPath: '/workspace/.ama/memory-stores/memstore_1' }],
      ),
    ).toEqual({ fields: { 'volumes.0.access': 'Use read_only or read_write.' } })
    expect(
      normalizeWorkspaceVolumes(
        [
          { name: 'memory-a', type: 'memory_store', storeId: 'memstore_1', access: 'read_only' },
          { name: 'memory-b', type: 'memory_store', storeId: 'memstore_1', access: 'read_write' },
        ],
        [
          { name: 'memory-a', mountPath: '/workspace/.ama/memory-stores/memstore_1' },
          { name: 'memory-b', mountPath: '/workspace/.ama/memory-stores/memstore_1' },
        ],
      ),
    ).toEqual({ fields: { 'volumeMounts.1.mountPath': 'Mount path must be unique within a session.' } })
  })

  it('adds store metadata to the runtime system prompt without memory contents', () => {
    const augmented = agentSnapshotWithWorkspaceContext(
      agentSnapshot(),
      [
        { name: 'source', type: 'github_repository', owner: 'saltbo', repo: 'agent-kanban', ref: 'main' },
        {
          name: 'Team memory',
          type: 'memory_store',
          storeId: 'memstore_1',
          description: 'Review conventions.',
          access: 'read_write',
          memories: [{ path: 'guide.md', content: 'secret memory content' }],
        },
      ],
      [
        { name: 'source', mountPath: '/workspace/repos/saltbo/agent-kanban' },
        { name: 'Team memory', mountPath: '/workspace/.ama/memory-stores/memstore_1' },
      ],
    )
    expect(augmented.instructions).toContain('Base instructions.')
    expect(augmented.instructions).toContain('Workspace layout:')
    expect(augmented.instructions).toContain('saltbo/agent-kanban at repos/saltbo/agent-kanban')
    expect(augmented.instructions).toContain('Team memory')
    expect(augmented.instructions).toContain('Review conventions.')
    expect(augmented.instructions).toContain('.ama/memory-stores/memstore_1')
    expect(augmented.instructions).not.toContain('secret memory content')
  })
})
