export type WorkspaceVolumeManifest = {
  version: 1
  workspaceRoot: string
  volumes: WorkspaceVolume[]
}

export type WorkspaceVolume =
  | {
      type: 'github_repository'
      name: unknown
      owner: unknown
      repo: unknown
      mountPath: unknown
      ref?: string
      credentialRef?: unknown
      status: 'declared'
    }
  | {
      type: 'memory_store'
      storeId: unknown
      name: unknown
      description: unknown
      access: unknown
      mountPath: unknown
      memories: Array<{ path: unknown }>
      status: 'declared'
    }
