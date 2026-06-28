// Internal runtime execution entities. These are the control-plane model for
// user-declared runtime inputs and the materialized inputs handed to a runtime
// host or runner after secret references have been resolved.

export interface EnvFromEntry {
  type: 'secret'
  name: string
  secretRef: string
}

export type Volume = SecretVolume | GitHubRepositoryVolume | MemoryStoreVolume

export interface SecretVolume {
  name: string
  type: 'secret'
  secretRef: string
}

export interface GitHubRepositoryVolume extends Record<string, unknown> {
  name: string
  type: 'github_repository'
  owner: string
  repo: string
  ref?: string | undefined
  credentialRef?: { credentialId: string; versionId?: string | undefined } | undefined
}

export interface MemoryStoreVolume extends Record<string, unknown> {
  name: string
  type: 'memory_store'
  storeId: string
  access: 'read_only' | 'read_write'
  storeName?: string | undefined
  description?: string | undefined
  memories?: Array<Record<string, unknown>> | undefined
}

export interface VolumeMount {
  name: string
  mountPath: string
  readOnly?: boolean | undefined
}

export interface ResolvedVolumeFile {
  path: string
  content: string
}

export interface ResolvedVolumeMount {
  name: string
  mountPath: string
  readOnly: boolean
  files: ResolvedVolumeFile[]
}

export interface RuntimeInputs {
  env: Record<string, string>
  envFrom: EnvFromEntry[]
  volumes: Volume[]
  volumeMounts: VolumeMount[]
}

export interface MaterializedRuntimeInputs {
  env: Record<string, string>
  volumes: ResolvedVolumeMount[]
}

export function isSecretVolume(volume: Volume): volume is SecretVolume {
  return volume.type === 'secret'
}

export function isGitHubRepositoryVolume(volume: Volume): volume is GitHubRepositoryVolume {
  return volume.type === 'github_repository'
}

export function isMemoryStoreVolume(volume: Volume): volume is MemoryStoreVolume {
  return volume.type === 'memory_store'
}

export function volumeMountPath(volumeName: string, volumeMounts: VolumeMount[]): string | null {
  return volumeMounts.find((mount) => mount.name === volumeName)?.mountPath ?? null
}

export function materializedRuntimeInputs(
  declaredEnv: Record<string, string>,
  resolvedEnv: Record<string, string>,
  resolvedVolumes: ResolvedVolumeMount[],
): MaterializedRuntimeInputs {
  return {
    env: { ...declaredEnv, ...resolvedEnv },
    volumes: resolvedVolumes,
  }
}
