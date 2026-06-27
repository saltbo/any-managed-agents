export type WorkspaceResourceManifest = {
  version: 1
  workspaceRoot: string
  resources: WorkspaceResource[]
}

export type WorkspaceResource =
  | {
      type: 'github_repository'
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
