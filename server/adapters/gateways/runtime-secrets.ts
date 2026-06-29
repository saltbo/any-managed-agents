import { gitRepositoryMountPath } from '@server/domain/git-repository'
import { memoryStoreIdFromRef, memoryStoreMountPath } from '@server/domain/memory-store'
import {
  isGitRepositoryVolume,
  isMemoryVolume,
  type EnvFromEntry,
  type Volume,
  type VolumeMount,
  volumeMountPath,
} from '@server/domain/runtime/execution-inputs'
import type {
  WorkspaceFile,
  WorkspaceGitCredential,
  WorkspaceManifest,
  WorkspaceManifestMount,
} from '@server/domain/workspace'
import type { RuntimeSecretGateway } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../../env'
import { decryptSecretValue } from '../../vault-crypto'
import { createRuntimeOrchestrationRepo } from '../repos/runtime-orchestration'

type Db = ReturnType<typeof drizzle>

// Resolves envFrom secret handles into runtime environment values. Both
// dispatch paths use this seam: self-hosted lease materialization and cloud
// session startup. AMA versions decrypt the stored ciphertext.
// Resolved values exist only in the runtime dispatch; they are never written
// to D1, session events, audit records, or logs.
export async function resolveRuntimeEnvFrom(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  items: EnvFromEntry[],
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  const repo = createRuntimeOrchestrationRepo(db)
  for (const entry of items) {
    if (entry.type !== 'secret') {
      throw new Error(`Runtime envFrom ${entry.name} has unsupported type ${entry.type}`)
    }
    const { secretRef } = entry
    const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
    // Deleted versions are physically removed, so a missing row is unresolvable.
    if (!version) {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    if (version.state === 'revoked') {
      throw new Error(`Runtime secret reference ${secretRef} is revoked by vault policy`)
    }
    const metadata = parseMetadata(version.metadata)
    const value = await decryptSecretValue(env, metadata?.encryptedSecretValue)
    if (typeof value !== 'string') {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    resolved[entry.name] = value
  }
  return resolved
}

export async function resolveRuntimeWorkspaceManifest(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  volumes: Volume[],
  volumeMounts: VolumeMount[],
): Promise<WorkspaceManifest> {
  const mounts: WorkspaceManifestMount[] = []
  const repo = createRuntimeOrchestrationRepo(db)
  for (const volume of volumes) {
    const mountPath = volumeMountPath(volume.name, volumeMounts)
    if (isGitRepositoryVolume(volume)) {
      const credential = volume.secretRef ? await resolveGitCredential(env, repo, scope, volume.secretRef) : undefined
      mounts.push({
        type: 'git_repository',
        name: volume.name,
        mountPath: mountPath ?? gitRepositoryMountPath(volume.url),
        url: volume.url,
        ...(volume.ref ? { ref: volume.ref } : {}),
        ...(credential ? { credential } : {}),
      })
      continue
    }
    if (isMemoryVolume(volume)) {
      const storeId = memoryStoreIdFromRef(volume.memoryRef)
      mounts.push({
        type: 'memory',
        name: volume.name,
        mountPath: mountPath ?? memoryStoreMountPath(storeId ?? volume.name),
        memoryRef: volume.memoryRef,
        access: volume.access,
        ...(volume.storeName ? { storeName: volume.storeName } : {}),
        ...(volume.description ? { description: volume.description } : {}),
        files: memoryFiles(volume.memories),
      })
      continue
    }
    if (volume.type === 'secret') {
      const resolved = await resolveSecretMount(env, repo, scope, volume.secretRef)
      mounts.push({
        type: 'secret',
        name: volume.name,
        mountPath: mountPath ?? `/workspace/.ama/secrets/${volume.name}`,
        readOnly: true,
        files: resolved,
      })
    }
  }
  return { root: '/workspace', mounts }
}

async function resolveGitCredential(
  env: Env,
  repo: ReturnType<typeof createRuntimeOrchestrationRepo>,
  scope: { organizationId: string; projectId: string },
  secretRef: string,
): Promise<WorkspaceGitCredential> {
  const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
  if (!version || version.state !== 'active') {
    throw new Error(`Runtime git secret reference ${secretRef} cannot be resolved`)
  }
  return parseGitCredential(await decryptVersion(env, version.metadata, version.secretRef))
}

function parseGitCredential(secret: string): WorkspaceGitCredential {
  const trimmed = secret.trim()
  const separator = trimmed.indexOf(':')
  if (separator >= 0) {
    return { username: trimmed.slice(0, separator), password: trimmed.slice(separator + 1) }
  }
  return { username: 'x-access-token', password: trimmed }
}

async function resolveSecretMount(
  env: Env,
  repo: ReturnType<typeof createRuntimeOrchestrationRepo>,
  scope: { organizationId: string; projectId: string },
  secretRef: string,
): Promise<WorkspaceFile[]> {
  const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
  if (version) {
    if (version.state !== 'active') {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    return [{ path: 'value', content: await decryptVersion(env, version.metadata, secretRef) }]
  }
  const versions = await repo.vaultVersionsForResolution(scope.organizationId, scope.projectId, secretRef)
  if (!versions) {
    throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
  }
  const files: WorkspaceFile[] = []
  for (const credentialVersion of versions) {
    if (credentialVersion.state !== 'active') {
      continue
    }
    files.push({
      path: safeFileName(credentialVersion.name),
      content: await decryptVersion(env, credentialVersion.metadata, credentialVersion.secretRef),
    })
  }
  return files
}

function memoryFiles(memories: Array<Record<string, unknown>> | undefined): WorkspaceFile[] {
  if (!Array.isArray(memories)) {
    return []
  }
  return memories.map((memory) => ({
    path: String(memory.path ?? ''),
    content: String(memory.content ?? ''),
  }))
}

async function decryptVersion(env: Env, metadata: string, secretRef: string) {
  const parsed = parseMetadata(metadata)
  const value = await decryptSecretValue(env, parsed?.encryptedSecretValue)
  if (typeof value !== 'string') {
    throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
  }
  return value
}

function safeFileName(value: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`Vault credential name cannot be mounted as a file: ${value}`)
  }
  return value
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Wraps runtime secret projections behind the gateway port. Resolved values are
// used only for runtime dispatch and never persisted.
export function createRuntimeSecretGateway(env: Env, db: Db): RuntimeSecretGateway {
  return {
    async resolveEnv(scope, items) {
      return resolveRuntimeEnvFrom(env, db, scope, items)
    },
    async resolveWorkspaceManifest(scope, volumes, volumeMounts) {
      return resolveRuntimeWorkspaceManifest(env, db, scope, volumes, volumeMounts)
    },
  }
}
