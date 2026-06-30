import { describe, expect, it } from 'vitest'
import { emptySession } from '@/console/defaults'
import type { MemoryStore } from '@/lib/amarpc'
import { sessionResourcesInput } from './session-resource-input'

const memoryStore: Pick<MemoryStore, 'metadata'> = {
  metadata: {
    uid: 'mem_store:alpha',
    pid: 'mem_store:alpha',
    name: 'Team memory',
    description: 'Shared operating context',
    labels: {},
    annotations: {},
    createdBy: 'user_1',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    archivedAt: null,
  },
}

describe('sessionResourcesInput', () => {
  it('maps credential vaults, repositories, and memory stores into volumes and mounts', () => {
    const result = sessionResourcesInput(
      {
        ...emptySession,
        credentialVaultIds: ['vault/one'],
        resources: [
          {
            id: 'repo:one',
            type: 'git_repository',
            url: ' https://github.com/saltbo/slink.git ',
            ref: ' main ',
          },
          {
            id: 'memory:one',
            type: 'memory',
            memoryStoreId: 'mem_store:alpha',
            access: 'read_write',
          },
        ],
      },
      [memoryStore],
    )

    expect(result.volumes).toEqual([
      { name: 'vault-vault-one', type: 'secret', secretRef: 'ama://vaults/vault%2Fone' },
      { name: 'repo-repo-one', type: 'git_repository', url: 'https://github.com/saltbo/slink.git', ref: 'main' },
      {
        name: 'memory-mem_store-alpha',
        type: 'memory',
        memoryRef: 'ama://memories/mem_store%3Aalpha',
        access: 'read_write',
        storeName: 'Team memory',
        description: 'Shared operating context',
      },
    ])
    expect(result.volumeMounts).toEqual([
      { name: 'vault-vault-one', mountPath: '/workspace/.ama/secrets/vault/one', readOnly: true },
      { name: 'repo-repo-one', mountPath: '/workspace/repos/github.com/saltbo/slink', readOnly: true },
      {
        name: 'memory-mem_store-alpha',
        mountPath: '/workspace/.ama/memory-stores/mem_store:alpha',
        readOnly: false,
      },
    ])
  })

  it('skips incomplete resources and falls back for non-url repository mounts', () => {
    const result = sessionResourcesInput(
      {
        ...emptySession,
        resources: [
          { id: 'blank', type: 'git_repository', url: ' ', ref: 'main' },
          { id: 'local path', type: 'git_repository', url: 'not a url', ref: '' },
          { id: 'memory-missing', type: 'memory', memoryStoreId: '', access: 'read_only' },
        ],
      },
      [],
    )

    expect(result.volumes).toEqual([{ name: 'repo-local-path', type: 'git_repository', url: 'not a url' }])
    expect(result.volumeMounts).toEqual([
      { name: 'repo-local-path', mountPath: '/workspace/repos/repository-2', readOnly: true },
    ])
  })

  it('uses default names and read-only memory mounts when optional metadata is absent', () => {
    const result = sessionResourcesInput(
      {
        ...emptySession,
        credentialVaultIds: ['%%%'],
        resources: [
          { id: '', type: 'git_repository', url: 'https://github.com', ref: '' },
          { id: 'memory-one', type: 'memory', memoryStoreId: 'memory-one', access: 'read_only' },
        ],
      },
      [
        {
          metadata: {
            ...memoryStore.metadata,
            uid: 'memory-one',
            name: '',
            description: null,
          },
        },
      ],
    )

    expect(result.volumes).toEqual([
      { name: 'vault-resource', type: 'secret', secretRef: 'ama://vaults/%25%25%25' },
      { name: 'repo-resource', type: 'git_repository', url: 'https://github.com' },
      { name: 'memory-memory-one', type: 'memory', memoryRef: 'ama://memories/memory-one', access: 'read_only' },
    ])
    expect(result.volumeMounts).toEqual([
      { name: 'vault-resource', mountPath: '/workspace/.ama/secrets/%%%', readOnly: true },
      { name: 'repo-resource', mountPath: '/workspace/repos/github.com/repository-1', readOnly: true },
      { name: 'memory-memory-one', mountPath: '/workspace/.ama/memory-stores/memory-one', readOnly: true },
    ])
  })
})
