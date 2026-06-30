import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceSpec, workspaceSpec } from '../workspace'
import { type AgentSnapshot, agentSnapshotWithWorkspaceContext } from './session-snapshot'

function agentSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    systemPrompt: 'Base instructions.',
    provider: 'workers-ai',
    model: '@cf/test/model',
    skills: [],
    subagents: [],
    allowedTools: ['read', 'bash'],
    mcpConnectors: [],
    createdAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
  }
}

describe('[spec: sessions/memory-store-resources] memory store volumes', () => {
  it('accepts managed memory store volumes and rejects unsafe mounts', () => {
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'ama://memories/memstore_1', access: 'read_only' }],
          [{ name: 'memory-memstore_1', mountPath: '/workspace/.ama/memory-stores/memstore_1' }],
        ),
      ).volumes,
    ).toEqual([
      { name: 'memory-memstore_1', type: 'memory', memoryRef: 'ama://memories/memstore_1', access: 'read_only' },
    ])

    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'ama://memories/memstore_1', access: 'read_only' }],
          [{ name: 'memory-memstore_1', mountPath: '/workspace/custom' }],
        ),
      ),
    ).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Memory store mounts must stay under /workspace/.ama/memory-stores.' },
    })
  })

  it('requires access and unique store ids per session', () => {
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            {
              name: 'memory-memstore_1',
              type: 'memory',
              memoryRef: 'ama://memories/memstore_1',
              access: 'writer' as never,
            },
          ],
          [{ name: 'memory-memstore_1', mountPath: '/workspace/.ama/memory-stores/memstore_1' }],
        ),
      ),
    ).toEqual({ fields: { 'volumes.0.access': 'Use read_only or read_write.' } })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            { name: 'memory-a', type: 'memory', memoryRef: 'ama://memories/memstore_1', access: 'read_only' },
            { name: 'memory-b', type: 'memory', memoryRef: 'ama://memories/memstore_1', access: 'read_write' },
          ],
          [
            { name: 'memory-a', mountPath: '/workspace/.ama/memory-stores/memstore_1' },
            { name: 'memory-b', mountPath: '/workspace/.ama/memory-stores/memstore_1' },
          ],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.1.mountPath': 'Mount path must be unique within a session.' } })
  })

  it('adds store metadata to the runtime system prompt without memory contents', () => {
    const augmented = agentSnapshotWithWorkspaceContext(
      agentSnapshot(),
      [
        { name: 'source', type: 'git_repository', url: 'https://github.com/saltbo/agent-kanban.git', ref: 'main' },
        {
          name: 'Team memory',
          type: 'memory',
          memoryRef: 'ama://memories/memstore_1',
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
    expect(augmented.systemPrompt).toContain('Base instructions.')
    expect(augmented.systemPrompt).toContain('Workspace layout:')
    expect(augmented.systemPrompt).toContain('https://github.com/saltbo/agent-kanban.git at repos/saltbo/agent-kanban')
    expect(augmented.systemPrompt).toContain('Team memory')
    expect(augmented.systemPrompt).toContain('Review conventions.')
    expect(augmented.systemPrompt).toContain('.ama/memory-stores/memstore_1')
    expect(augmented.systemPrompt).not.toContain('secret memory content')
  })
})
